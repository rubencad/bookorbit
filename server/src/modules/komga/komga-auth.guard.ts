import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Permission } from '@bookorbit/types';
import { BasicCredentialCache } from '../../common/auth/basic-credential-cache';
import { PermissionService } from '../../common/services/permission.service';
import type * as schema from '../../db/schema';
import { UserService } from '../user/user.service';
import { KomgaUserService } from './komga-user.service';
import { KOMGA_BASIC_REALM } from './komga.constants';

type KomgaUserRow = typeof schema.komgaUsers.$inferSelect;
const BASIC_CHALLENGE = `Basic realm="${KOMGA_BASIC_REALM}"`;
const AUTH_EVENT = 'komga.auth';

export interface KomgaRequestAccount {
  id: number;
  userId: number;
  username: string;
  groupUnknownSeries: boolean;
  includeNonComicBooks: boolean;
}

@Injectable()
export class KomgaAuthGuard implements CanActivate {
  private readonly logger = new Logger(KomgaAuthGuard.name);

  constructor(
    private readonly komgaUserService: KomgaUserService,
    private readonly userService: UserService,
    private readonly permissionService: PermissionService,
    private readonly credentialCache: BasicCredentialCache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

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

    const account = await this.resolveAccount(username, password);
    if (!account) {
      this.logger.warn(`[${AUTH_EVENT}] [fail] reason=invalid_credentials ip=${request.ip} - Komga Basic authentication rejected`);
      reply.header('WWW-Authenticate', BASIC_CHALLENGE);
      throw new UnauthorizedException('Invalid credentials');
    }

    const fullUser = await this.userService.findByIdWithPermissions(account.userId);
    if (!fullUser) {
      throw new UnauthorizedException('Account not found');
    }
    if (!fullUser.active) {
      throw new UnauthorizedException('Account is disabled');
    }
    if (!this.permissionService.userHas(fullUser, Permission.KomgaAccess)) {
      throw new ForbiddenException('Komga access revoked');
    }

    const target = request as unknown as Record<string, unknown>;
    target.user = fullUser;
    target.komgaAccount = {
      id: account.id,
      userId: account.userId,
      username: account.username,
      groupUnknownSeries: account.groupUnknownSeries,
      includeNonComicBooks: account.includeNonComicBooks,
    } satisfies KomgaRequestAccount;

    return true;
  }

  private async resolveAccount(username: string, password: string): Promise<KomgaUserRow | null> {
    const cached = this.credentialCache.get(KOMGA_BASIC_REALM, username, password);
    if (cached) {
      const account = await this.komgaUserService.findById(cached.accountId);
      if (account) return account;
      this.credentialCache.invalidateAccount(KOMGA_BASIC_REALM, cached.accountId);
    }

    const account = await this.komgaUserService.validateCredentials(username, password);
    if (!account) return null;

    this.credentialCache.set(KOMGA_BASIC_REALM, username, password, { accountId: account.id, userId: account.userId });
    return account;
  }
}
