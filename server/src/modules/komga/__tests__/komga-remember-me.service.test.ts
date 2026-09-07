import type { FastifyReply, FastifyRequest } from 'fastify';

import { KomgaRememberMeService } from '../komga-remember-me.service';
import type { KomgaUserService } from '../komga-user.service';

const ACCOUNT = {
  id: 10,
  userId: 1,
  username: 'komelia',
  passwordHash: '$2a$12$hash',
  groupUnknownSeries: true,
  includeNonComicBooks: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const COOKIE = 'komga-remember-me';
const YEAR_SECONDS = 365 * 24 * 60 * 60;
const COOKIE_OPTIONS = { httpOnly: true, sameSite: 'strict', path: '/komga', secure: 'auto' };

function makeService(secret = 'test-secret') {
  const komgaUserService = { findById: vi.fn((id: number) => Promise.resolve(id === ACCOUNT.id ? ACCOUNT : null)) };
  const service = new KomgaRememberMeService(komgaUserService as unknown as KomgaUserService, { jwtSecret: secret } as never);
  return { service, komgaUserService };
}

function requestWith(cookies?: Record<string, string>, query?: Record<string, unknown>) {
  return { cookies, query } as unknown as FastifyRequest;
}

function issue(service: KomgaRememberMeService): string {
  const reply = { setCookie: vi.fn() };
  service.issue(reply as unknown as FastifyReply, ACCOUNT);
  return reply.setCookie.mock.calls[0][1] as string;
}

describe('KomgaRememberMeService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts true, on, yes and 1 as remember-me values', () => {
    const { service } = makeService();
    for (const value of ['true', 'TRUE', 'on', 'yes', '1']) {
      expect(service.isRequested(requestWith({}, { 'remember-me': value }))).toBe(true);
    }
    expect(service.isRequested(requestWith({}, { 'remember-me': 'false' }))).toBe(false);
    expect(service.isRequested(requestWith({}, { 'remember-me': ['true'] }))).toBe(false);
    expect(service.isRequested(requestWith({}, {}))).toBe(false);
    expect(service.isRequested(requestWith())).toBe(false);
  });

  it('issues a year-long HttpOnly cookie scoped to the Komga path', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T12:00:00Z'));
    const { service } = makeService();
    const reply = { setCookie: vi.fn() };

    service.issue(reply as unknown as FastifyReply, ACCOUNT);

    const expiresAt = Math.floor(Date.UTC(2026, 8, 7, 12) / 1000) + YEAR_SECONDS;
    expect(reply.setCookie).toHaveBeenCalledWith(COOKIE, expect.stringMatching(new RegExp(`^10\\.${expiresAt}\\.[A-Za-z0-9_-]{43}$`)), {
      ...COOKIE_OPTIONS,
      maxAge: YEAR_SECONDS,
    });
  });

  it('resolves the account behind a cookie it issued', async () => {
    const { service, komgaUserService } = makeService();
    const token = issue(service);

    await expect(service.resolve(requestWith({ [COOKIE]: token }))).resolves.toEqual({ status: 'valid', account: ACCOUNT });
    expect(komgaUserService.findById).toHaveBeenCalledWith(10);
  });

  it('reports an absent cookie without touching the database', async () => {
    const { service, komgaUserService } = makeService();

    await expect(service.resolve(requestWith({}))).resolves.toEqual({ status: 'absent' });
    await expect(service.resolve(requestWith())).resolves.toEqual({ status: 'absent' });
    expect(komgaUserService.findById).not.toHaveBeenCalled();
  });

  it('rejects malformed and forged cookies', async () => {
    const { service } = makeService();
    const token = issue(service);
    const [id, expiresAt, signature] = token.split('.');
    const flipped = signature.endsWith('A') ? `${signature.slice(0, -1)}B` : `${signature.slice(0, -1)}A`;

    await expect(service.resolve(requestWith({ [COOKIE]: 'garbage' }))).resolves.toEqual({ status: 'invalid' });
    await expect(service.resolve(requestWith({ [COOKIE]: `${id}.${expiresAt}.${flipped}` }))).resolves.toEqual({ status: 'invalid' });
    await expect(service.resolve(requestWith({ [COOKIE]: `${id}.${Number(expiresAt) + 1}.${signature}` }))).resolves.toEqual({ status: 'invalid' });
    await expect(service.resolve(requestWith({ [COOKIE]: `11.${expiresAt}.${signature}` }))).resolves.toEqual({ status: 'invalid' });
    await expect(makeService('other-secret').service.resolve(requestWith({ [COOKIE]: token }))).resolves.toEqual({ status: 'invalid' });
  });

  it('rejects account ids outside the serial range before touching the database', async () => {
    const { service, komgaUserService } = makeService();
    const [, expiresAt, signature] = issue(service).split('.');

    await expect(service.resolve(requestWith({ [COOKIE]: `0.${expiresAt}.${signature}` }))).resolves.toEqual({ status: 'invalid' });
    await expect(service.resolve(requestWith({ [COOKIE]: `2147483648.${expiresAt}.${signature}` }))).resolves.toEqual({ status: 'invalid' });
    expect(komgaUserService.findById).not.toHaveBeenCalled();
  });

  it('rejects expired cookies', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T12:00:00Z'));
    const { service } = makeService();
    const token = issue(service);

    vi.setSystemTime(new Date('2027-09-07T11:59:59Z'));
    await expect(service.resolve(requestWith({ [COOKIE]: token }))).resolves.toEqual({ status: 'valid', account: ACCOUNT });
    vi.setSystemTime(new Date('2027-09-07T12:00:00Z'));
    await expect(service.resolve(requestWith({ [COOKIE]: token }))).resolves.toEqual({ status: 'invalid' });
  });

  it('rejects cookies of deleted accounts and of accounts whose password changed', async () => {
    const { service, komgaUserService } = makeService();
    const token = issue(service);

    komgaUserService.findById.mockResolvedValue(null);
    await expect(service.resolve(requestWith({ [COOKIE]: token }))).resolves.toEqual({ status: 'invalid' });

    komgaUserService.findById.mockResolvedValue({ ...ACCOUNT, passwordHash: '$2a$12$rotated' });
    await expect(service.resolve(requestWith({ [COOKIE]: token }))).resolves.toEqual({ status: 'invalid' });
  });

  it('clears the cookie with the same scope it was issued with', () => {
    const { service } = makeService();
    const reply = { setCookie: vi.fn() };

    service.clear(reply as unknown as FastifyReply);

    expect(reply.setCookie).toHaveBeenCalledWith(COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
  });
});
