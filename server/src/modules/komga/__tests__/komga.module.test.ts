import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { CommonModule } from '../../../common/common.module';
import { KomgaUserController } from '../komga-user.controller';
import { KomgaUserRepository } from '../komga-user.repository';
import { KomgaUserService } from '../komga-user.service';
import { KomgaModule } from '../komga.module';

describe('KomgaModule', () => {
  it('registers the module wiring', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, KomgaModule)).toEqual([CommonModule]);
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, KomgaModule)).toEqual([KomgaUserController]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, KomgaModule)).toEqual([KomgaUserRepository, KomgaUserService]);
  });
});
