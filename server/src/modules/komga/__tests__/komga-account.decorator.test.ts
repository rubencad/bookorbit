import 'reflect-metadata';

import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { ExecutionContext } from '@nestjs/common';

import { KomgaAccount } from '../komga-account.decorator';

describe('KomgaAccount decorator', () => {
  it('extracts the Komga account the guard attached to the request', () => {
    class TestController {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      handler(@KomgaAccount() _account: unknown) {}
    }

    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestController, 'handler') as Record<
      string,
      { factory: (data: unknown, ctx: ExecutionContext) => unknown }
    >;
    const factory = Object.values(metadata)[0]?.factory;
    const account = { id: 3, userId: 9, username: 'mihon', groupUnknownSeries: true, includeNonComicBooks: false };
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ komgaAccount: account }) }) } as unknown as ExecutionContext;

    expect(factory).toBeDefined();
    expect(factory(undefined, ctx)).toEqual(account);
  });
});
