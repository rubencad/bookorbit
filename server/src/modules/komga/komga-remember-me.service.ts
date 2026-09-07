import { createHmac, timingSafeEqual } from 'crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { authConfig } from '../../config/config';
import type { KomgaUserRow } from './komga-user.repository';
import { KomgaUserService } from './komga-user.service';
import {
  KOMGA_REMEMBER_ME_COOKIE,
  KOMGA_REMEMBER_ME_COOKIE_PATH,
  KOMGA_REMEMBER_ME_PARAM,
  KOMGA_REMEMBER_ME_VALIDITY_SECONDS,
} from './komga.constants';

const REQUESTED_VALUES = new Set(['true', 'on', 'yes', '1']);
const TOKEN_PATTERN = /^(\d{1,10})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;
const MAX_SERIAL_ID = 2_147_483_647;
const COOKIE_OPTIONS = { httpOnly: true, sameSite: 'strict', path: KOMGA_REMEMBER_ME_COOKIE_PATH, secure: 'auto' } as const;

export type RememberMeResolution = { status: 'absent' } | { status: 'invalid' } | { status: 'valid'; account: KomgaUserRow };

@Injectable()
export class KomgaRememberMeService {
  constructor(
    private readonly komgaUserService: KomgaUserService,
    @Inject(authConfig.KEY) private readonly auth: ConfigType<typeof authConfig>,
  ) {}

  isRequested(request: FastifyRequest): boolean {
    const value = (request.query as Record<string, unknown> | undefined)?.[KOMGA_REMEMBER_ME_PARAM];
    return typeof value === 'string' && REQUESTED_VALUES.has(value.toLowerCase());
  }

  issue(reply: FastifyReply, account: KomgaUserRow): void {
    const expiresAt = nowSeconds() + KOMGA_REMEMBER_ME_VALIDITY_SECONDS;
    const token = `${account.id}.${expiresAt}.${this.sign(account.id, expiresAt, account.passwordHash)}`;
    reply.setCookie(KOMGA_REMEMBER_ME_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: KOMGA_REMEMBER_ME_VALIDITY_SECONDS });
  }

  clear(reply: FastifyReply): void {
    reply.setCookie(KOMGA_REMEMBER_ME_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
  }

  async resolve(request: FastifyRequest): Promise<RememberMeResolution> {
    const token = request.cookies?.[KOMGA_REMEMBER_ME_COOKIE];
    if (!token) return { status: 'absent' };

    const match = TOKEN_PATTERN.exec(token);
    if (!match) return { status: 'invalid' };
    const accountId = Number(match[1]);
    const expiresAt = Number(match[2]);
    if (accountId < 1 || accountId > MAX_SERIAL_ID || expiresAt <= nowSeconds()) return { status: 'invalid' };

    const account = await this.komgaUserService.findById(accountId);
    if (!account) return { status: 'invalid' };

    const expected = Buffer.from(this.sign(account.id, expiresAt, account.passwordHash));
    const actual = Buffer.from(match[3]);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { status: 'invalid' };

    return { status: 'valid', account };
  }

  private sign(accountId: number, expiresAt: number, passwordHash: string): string {
    return createHmac('sha256', this.auth.jwtSecret)
      .update(`${KOMGA_REMEMBER_ME_COOKIE}:${accountId}:${expiresAt}:${passwordHash}`)
      .digest('base64url');
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
