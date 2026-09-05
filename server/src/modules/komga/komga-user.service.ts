import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';

import { BasicCredentialCache } from '../../common/auth/basic-credential-cache';
import { isUniqueViolation } from '../../common/utils/db-error.utils';
import { CreateKomgaUserDto } from './dto/create-komga-user.dto';
import { UpdateKomgaUserDto } from './dto/update-komga-user.dto';
import { KomgaUserRepository, type KomgaUserOptions, type KomgaUserRow } from './komga-user.repository';
import { KOMGA_BASIC_REALM } from './komga.constants';

@Injectable()
export class KomgaUserService {
  constructor(
    private readonly repository: KomgaUserRepository,
    private readonly credentialCache: BasicCredentialCache,
  ) {}

  findAllForUser(userId: number) {
    return this.repository.findAllForUser(userId);
  }

  async create(userId: number, dto: CreateKomgaUserDto) {
    const passwordHash = await hash(dto.password, 12);
    try {
      return await this.repository.insert({
        userId,
        username: dto.username,
        passwordHash,
        groupUnknownSeries: dto.groupUnknownSeries ?? true,
        includeNonComicBooks: dto.includeNonComicBooks ?? false,
      });
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('A Komga account with this username already exists');
      }
      throw err;
    }
  }

  async update(userId: number, komgaUserId: number, dto: UpdateKomgaUserDto) {
    const options: KomgaUserOptions = {
      ...(dto.groupUnknownSeries !== undefined ? { groupUnknownSeries: dto.groupUnknownSeries } : {}),
      ...(dto.includeNonComicBooks !== undefined ? { includeNonComicBooks: dto.includeNonComicBooks } : {}),
    };
    if (Object.keys(options).length === 0) {
      throw new BadRequestException('No account options were provided');
    }
    await this.verifyOwnership(userId, komgaUserId);
    const updated = await this.repository.updateOptions(komgaUserId, options);
    if (!updated) throw new NotFoundException('Komga account not found');
    return updated;
  }

  async delete(userId: number, komgaUserId: number): Promise<void> {
    await this.verifyOwnership(userId, komgaUserId);
    await this.repository.deleteById(komgaUserId);
    this.credentialCache.invalidateAccount(KOMGA_BASIC_REALM, komgaUserId);
  }

  findById(komgaUserId: number): Promise<KomgaUserRow | null> {
    return this.repository.findById(komgaUserId);
  }

  async validateCredentials(username: string, password: string): Promise<KomgaUserRow | null> {
    const account = await this.repository.findByUsername(username);
    if (!account) return null;

    const valid = await compare(password, account.passwordHash);
    return valid ? account : null;
  }

  private async verifyOwnership(userId: number, komgaUserId: number): Promise<void> {
    const row = await this.repository.findOwned(userId, komgaUserId);
    if (!row) throw new ForbiddenException('Not the owner of this Komga account');
  }
}
