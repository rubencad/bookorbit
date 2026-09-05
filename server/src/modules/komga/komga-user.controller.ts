import { Permission } from '@bookorbit/types';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateKomgaUserDto } from './dto/create-komga-user.dto';
import { UpdateKomgaUserDto } from './dto/update-komga-user.dto';
import { KomgaUserService } from './komga-user.service';

@Controller('komga-users')
@RequirePermission(Permission.KomgaAccess)
export class KomgaUserController {
  constructor(private readonly komgaUserService: KomgaUserService) {}

  @Get()
  findAll(@CurrentUser() user: RequestUser) {
    return this.komgaUserService.findAllForUser(user.id);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateKomgaUserDto) {
    return this.komgaUserService.create(user.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateKomgaUserDto) {
    return this.komgaUserService.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.komgaUserService.delete(user.id, id);
  }
}
