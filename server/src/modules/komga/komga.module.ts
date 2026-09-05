import { Module } from '@nestjs/common';

import { CommonModule } from '../../common/common.module';
import { KomgaUserController } from './komga-user.controller';
import { KomgaUserRepository } from './komga-user.repository';
import { KomgaUserService } from './komga-user.service';

@Module({
  imports: [CommonModule],
  controllers: [KomgaUserController],
  providers: [KomgaUserRepository, KomgaUserService],
})
export class KomgaModule {}
