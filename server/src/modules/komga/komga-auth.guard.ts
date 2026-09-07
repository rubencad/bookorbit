import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Permission } from '@bookorbit/types';
import { BasicCredentialCache } from '../../common/auth/basic-credential-cache';
import { PermissionService } from '../../common/services/permission.service';
import type * as schema from '../../db/schema';
import { UserService } from '../user/user.service';
import { KomgaRememberMeService } from './komga-remember-me.service';
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

interface AuthenticatedAccount {
  account: KomgaUserRow;
  viaBasic: boolean;
}

@Injectable()
export class KomgaAuthGuard implements CanActivate {
  private readonly logger = new Logger(KomgaAuthGuard.name);

  constructor(
    private readonly komgaUserService: KomgaUserService,
    private readonly userService: UserService,
    private readonly permissionService: PermissionService,
    private readonly credentialCache: BasicCredentialCache,
    private readonly rememberMe: KomgaRememberMeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    const { account, viaBasic } = await this.authenticate(request, reply);

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

    if (viaBasic && this.rememberMe.isRequested(request)) {
      this.rememberMe.issue(reply, account);
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

  private async authenticate(request: FastifyRequest, reply: FastifyReply): Promise<AuthenticatedAccount> {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Basic ')) {
      return { account: await this.authenticateBasic(authHeader.slice(6), request, reply), viaBasic: true };
    }

    const remembered = await this.rememberMe.resolve(request);
    if (remembered.status === 'valid') {
      return { account: remembered.account, viaBasic: false };
    }

    reply.header('WWW-Authenticate', BASIC_CHALLENGE);
    if (remembered.status === 'invalid') {
      this.logger.warn(`[${AUTH_EVENT}] [fail] reason=invalid_remember_me ip=${request.ip} - Komga remember-me cookie rejected`);
      this.rememberMe.clear(reply);
      throw new UnauthorizedException('Invalid remember-me cookie');
    }
    throw new UnauthorizedException('Basic authentication required');
  }

  private async authenticateBasic(encoded: string, request: FastifyRequest, reply: FastifyReply): Promise<KomgaUserRow> {
    const decoded = Buffer.from(encoded, 'base64').toString();
    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) {
      reply.header('WWW-Authenticate', BASIC_CHALLENGE);
      throw new UnauthorizedException('Invalid credentials');
    }

    const account = await this.resolveAccount(decoded.slice(0, colonIndex), decoded.slice(colonIndex + 1));
    if (!account) {
      this.logger.warn(`[${AUTH_EVENT}] [fail] reason=invalid_credentials ip=${request.ip} - Komga Basic authentication rejected`);
      reply.header('WWW-Authenticate', BASIC_CHALLENGE);
      throw new UnauthorizedException('Invalid credentials');
    }
    return account;
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
