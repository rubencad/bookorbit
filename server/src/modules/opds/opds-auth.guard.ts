import { createHmac, timingSafeEqual } from 'crypto';

import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Permission } from '@bookorbit/types';
import type { ContentFilterRules } from '@bookorbit/types';
import { BasicCredentialCache } from '../../common/auth/basic-credential-cache';
import { PermissionService } from '../../common/services/permission.service';
import type * as schema from '../../db/schema';
import { OPDS_BASIC_REALM } from './opds.constants';
import { OpdsUserService } from './opds-user.service';
import { UserService } from '../user/user.service';

type OpdsUserRow = typeof schema.opdsUsers.$inferSelect;
const BASIC_CHALLENGE = `Basic realm="${OPDS_BASIC_REALM}"`;

export interface OpdsRequestUser {
  opdsUserId: number;
  userId: number;
  username: string;
  sortOrder: 'recent' | 'title_asc' | 'title_desc' | 'author_asc' | 'author_desc' | 'series_asc' | 'series_desc';
  isSuperuser: boolean;
  coverToken: string;
  contentFilters: ContentFilterRules;
}

export function createCoverToken(userId: number, secret: string): string {
  const sig = createHmac('sha256', secret).update(String(userId)).digest('hex').slice(0, 32);
  return `${userId}.${sig}`;
}

function stripQuery(url: string): string {
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) return url;
  return url.slice(0, queryIndex);
}

function isTokenImagePath(requestPath: string): boolean {
  return /(?:^|\/)(?:api\/v1\/)?opds\/\d+\/(cover|thumbnail)$/.test(requestPath.replace(/^\//, ''));
}

function parseCoverToken(token: string, secret: string): number | null {
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const userId = parseInt(token.slice(0, dot), 10);
  if (isNaN(userId) || userId <= 0) return null;
  const expected = createCoverToken(userId, secret);
  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  if (tokenBuffer.length !== expectedBuffer.length || !timingSafeEqual(tokenBuffer, expectedBuffer)) {
    return null;
  }
  return userId;
}

@Injectable()
export class OpdsAuthGuard implements CanActivate {
  constructor(
    private readonly opdsUserService: OpdsUserService,
    private readonly userService: UserService,
    private readonly permissionService: PermissionService,
    private readonly config: ConfigService,
    private readonly credentialCache: BasicCredentialCache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    const tokenQuery = (request.query as Record<string, string | string[] | undefined>).t;
    const tokenParam = Array.isArray(tokenQuery) ? tokenQuery[0] : tokenQuery;
    if (tokenParam) {
      const requestPath = stripQuery(request.url ?? '');
      if (!isTokenImagePath(requestPath)) {
        reply.header('WWW-Authenticate', BASIC_CHALLENGE);
        throw new UnauthorizedException('Basic authentication required');
      }

      const secret = this.config.get<string>('auth.jwtSecret')!;
      const userId = parseCoverToken(tokenParam, secret);
      if (!userId) throw new UnauthorizedException('Invalid token');

      const fullUser = await this.userService.findByIdWithPermissions(userId);
      if (!fullUser || !fullUser.active) throw new UnauthorizedException('Account not found or disabled');
      if (!this.permissionService.userHas(fullUser, Permission.OpdsAccess)) throw new ForbiddenException('OPDS access revoked');

      (request as unknown as Record<string, unknown>).opdsUser = {
        opdsUserId: 0,
        userId: fullUser.id,
        username: fullUser.username,
        sortOrder: 'recent',
        isSuperuser: fullUser.isSuperuser,
        coverToken: tokenParam,
        contentFilters: fullUser.contentFilters,
      } satisfies OpdsRequestUser;

      return true;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Basic ')) {
      reply.header('WWW-Authenticate', BASIC_CHALLENGE);
      throw new UnauthorizedException('Basic authentication required');
    }

    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) {
      reply.header('WWW-Authenticate', BASIC_CHALLENGE);
      throw new UnauthorizedException('Invalid credentials');
    }

    const username = decoded.slice(0, colonIndex);
    const password = decoded.slice(colonIndex + 1);

    const opdsUser = await this.resolveOpdsUser(username, password);
    if (!opdsUser) {
      reply.header('WWW-Authenticate', BASIC_CHALLENGE);
      throw new UnauthorizedException('Invalid credentials');
    }

    const fullUser = await this.userService.findByIdWithPermissions(opdsUser.userId);
    if (!fullUser) {
      throw new UnauthorizedException('Account not found');
    }

    if (!fullUser.active) {
      throw new UnauthorizedException('Account is disabled');
    }

    if (!this.permissionService.userHas(fullUser, Permission.OpdsAccess)) {
      throw new ForbiddenException('OPDS access revoked');
    }

    const secret = this.config.get<string>('auth.jwtSecret')!;

    (request as unknown as Record<string, unknown>).opdsUser = {
      opdsUserId: opdsUser.id,
      userId: opdsUser.userId,
      username: opdsUser.username,
      sortOrder: opdsUser.sortOrder,
      isSuperuser: fullUser.isSuperuser,
      coverToken: createCoverToken(opdsUser.userId, secret),
      contentFilters: fullUser.contentFilters,
    } satisfies OpdsRequestUser;

    return true;
  }

  private async resolveOpdsUser(username: string, password: string): Promise<OpdsUserRow | null> {
    const cached = this.credentialCache.get(OPDS_BASIC_REALM, username, password);
    if (cached) {
      const opdsUser = await this.opdsUserService.findById(cached.accountId);
      if (opdsUser) return opdsUser;
      this.credentialCache.invalidateAccount(OPDS_BASIC_REALM, cached.accountId);
    }

    const result = await this.opdsUserService.validateCredentials(username, password);
    if (!result) return null;

    this.credentialCache.set(OPDS_BASIC_REALM, username, password, { accountId: result.opdsUser.id, userId: result.opdsUser.userId });
    return result.opdsUser;
  }
}
