import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { BasicCredentialCache } from '../../../common/auth/basic-credential-cache';
import type { PermissionService } from '../../../common/services/permission.service';
import type { UserService } from '../../user/user.service';
import { KomgaAuthGuard } from '../komga-auth.guard';
import type { KomgaUserService } from '../komga-user.service';

const ACCOUNT = {
  id: 10,
  userId: 1,
  username: 'mihon',
  passwordHash: '$2a',
  groupUnknownSeries: false,
  includeNonComicBooks: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const FULL_USER = {
  id: 1,
  username: 'ruben',
  name: 'Ruben',
  email: null,
  active: true,
  isSuperuser: false,
  isDefaultPassword: false,
  tokenVersion: 1,
  settings: {},
  avatarUrl: null,
  provisioningMethod: 'local',
  permissions: [Permission.KomgaAccess],
  contentFilters: { includeTagIds: [], includeGenreIds: [], excludeTagIds: [], excludeGenreIds: [] },
};

function basicHeader(user: string, pass: string) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

function mockContext(authorization?: string) {
  const request: Record<string, unknown> = { headers: { authorization }, ip: '127.0.0.1' };
  const reply = { header: vi.fn() };
  const context = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }) } as unknown as ExecutionContext;
  return { request, reply, context };
}

function makeGuard(overrides: { account?: unknown; fullUser?: unknown; userHas?: boolean; cache?: BasicCredentialCache } = {}) {
  const komgaUserService = {
    validateCredentials: vi.fn().mockResolvedValue(overrides.account !== undefined ? overrides.account : ACCOUNT),
    findById: vi.fn().mockResolvedValue(overrides.account !== undefined ? overrides.account : ACCOUNT),
  };
  const userService = { findByIdWithPermissions: vi.fn().mockResolvedValue(overrides.fullUser !== undefined ? overrides.fullUser : FULL_USER) };
  const permissionService = { userHas: vi.fn().mockReturnValue(overrides.userHas ?? true) };
  const guard = new KomgaAuthGuard(
    komgaUserService as unknown as KomgaUserService,
    userService as unknown as UserService,
    permissionService as unknown as PermissionService,
    overrides.cache ?? new BasicCredentialCache(),
  );
  return { guard, komgaUserService, userService, permissionService };
}

describe('KomgaAuthGuard', () => {
  it('challenges requests without Basic credentials', async () => {
    const { guard } = makeGuard();
    const { context, reply } = mockContext(undefined);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(reply.header).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="bookorbit Komga"');
  });

  it('rejects malformed and invalid credentials with a challenge', async () => {
    const malformed = makeGuard();
    const malformedCtx = mockContext(`Basic ${Buffer.from('no-colon').toString('base64')}`);
    await expect(malformed.guard.canActivate(malformedCtx.context)).rejects.toThrow('Invalid credentials');
    expect(malformedCtx.reply.header).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="bookorbit Komga"');

    const invalid = makeGuard({ account: null });
    const invalidCtx = mockContext(basicHeader('mihon', 'wrong'));
    await expect(invalid.guard.canActivate(invalidCtx.context)).rejects.toThrow('Invalid credentials');
    expect(invalidCtx.reply.header).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="bookorbit Komga"');
  });

  it('rejects missing, disabled and unpermitted parent users', async () => {
    await expect(makeGuard({ fullUser: null }).guard.canActivate(mockContext(basicHeader('mihon', 'pw')).context)).rejects.toThrow(
      'Account not found',
    );
    await expect(
      makeGuard({ fullUser: { ...FULL_USER, active: false } }).guard.canActivate(mockContext(basicHeader('mihon', 'pw')).context),
    ).rejects.toThrow('Account is disabled');
    await expect(makeGuard({ userHas: false }).guard.canActivate(mockContext(basicHeader('mihon', 'pw')).context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('attaches the full user and the account options to the request', async () => {
    const { guard, permissionService } = makeGuard();
    const { context, request } = mockContext(basicHeader('mihon', 'pw'));
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(FULL_USER);
    expect(request.komgaAccount).toEqual({ id: 10, userId: 1, username: 'mihon', groupUnknownSeries: false, includeNonComicBooks: true });
    expect(permissionService.userHas).toHaveBeenCalledWith(FULL_USER, Permission.KomgaAccess);
  });

  it('verifies the password once and then serves the account from the credential cache', async () => {
    const cache = new BasicCredentialCache();
    const { guard, komgaUserService } = makeGuard({ cache });
    await guard.canActivate(mockContext(basicHeader('mihon', 'pw')).context);
    await guard.canActivate(mockContext(basicHeader('mihon', 'pw')).context);
    expect(komgaUserService.validateCredentials).toHaveBeenCalledTimes(1);
    expect(komgaUserService.findById).toHaveBeenCalledWith(10);
  });

  it('falls back to a full check when the cached account no longer exists', async () => {
    const cache = new BasicCredentialCache();
    cache.set('bookorbit Komga', 'mihon', 'pw', { accountId: 10, userId: 1 });
    const { guard, komgaUserService } = makeGuard({ cache });
    komgaUserService.findById.mockResolvedValue(null);
    komgaUserService.validateCredentials.mockResolvedValue(null);
    await expect(guard.canActivate(mockContext(basicHeader('mihon', 'pw')).context)).rejects.toThrow('Invalid credentials');
    expect(komgaUserService.validateCredentials).toHaveBeenCalledWith('mihon', 'pw');
    expect(cache.get('bookorbit Komga', 'mihon', 'pw')).toBeNull();
  });
});
