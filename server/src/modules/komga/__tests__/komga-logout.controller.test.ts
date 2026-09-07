import type { FastifyReply } from 'fastify';

import { KomgaLogoutController } from '../komga-logout.controller';
import type { KomgaRememberMeService } from '../komga-remember-me.service';

describe('KomgaLogoutController', () => {
  it('clears the remember-me cookie on logout', () => {
    const rememberMe = { clear: vi.fn() };
    const reply = {} as FastifyReply;

    new KomgaLogoutController(rememberMe as unknown as KomgaRememberMeService).logout(reply);

    expect(rememberMe.clear).toHaveBeenCalledWith(reply);
  });
});
