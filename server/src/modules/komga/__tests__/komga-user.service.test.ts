import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

vi.mock('bcryptjs', () => ({
  hash: vi.fn((value: string) => Promise.resolve(`mock-hash:${value}`)),
  compare: vi.fn((plain: string, hashed: string) => Promise.resolve(hashed === `mock-hash:${plain}`)),
}));

import { BasicCredentialCache } from '../../../common/auth/basic-credential-cache';
import { KomgaUserRepository } from '../komga-user.repository';
import { KomgaUserService } from '../komga-user.service';
import { KOMGA_BASIC_REALM } from '../komga.constants';

const ACCOUNT = {
  id: 7,
  userId: 5,
  username: 'mihon',
  passwordHash: 'mock-hash:password123',
  groupUnknownSeries: true,
  includeNonComicBooks: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeRepository() {
  return {
    findAllForUser: vi.fn().mockResolvedValue([ACCOUNT]),
    insert: vi.fn().mockResolvedValue({ id: 7 }),
    updateOptions: vi.fn().mockResolvedValue({ ...ACCOUNT, includeNonComicBooks: true }),
    deleteById: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(ACCOUNT),
    findByUsername: vi.fn().mockResolvedValue(ACCOUNT),
    findOwned: vi.fn().mockResolvedValue(ACCOUNT),
  };
}

describe('KomgaUserService', () => {
  let service: KomgaUserService;
  let repository: ReturnType<typeof makeRepository>;
  let credentialCache: { invalidateAccount: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    repository = makeRepository();
    credentialCache = { invalidateAccount: vi.fn() };
    const module = await Test.createTestingModule({
      providers: [
        KomgaUserService,
        { provide: KomgaUserRepository, useValue: repository },
        { provide: BasicCredentialCache, useValue: credentialCache },
      ],
    }).compile();
    service = module.get(KomgaUserService);
  });

  it('lists the accounts of one user', async () => {
    await expect(service.findAllForUser(5)).resolves.toEqual([ACCOUNT]);
    expect(repository.findAllForUser).toHaveBeenCalledWith(5);
  });

  it('hashes the password and applies the option defaults on create', async () => {
    await expect(service.create(5, { username: 'mihon', password: 'password123' })).resolves.toEqual({ id: 7 });
    expect(repository.insert).toHaveBeenCalledWith({
      userId: 5,
      username: 'mihon',
      passwordHash: 'mock-hash:password123',
      groupUnknownSeries: true,
      includeNonComicBooks: false,
    });
  });

  it('translates a unique violation into a conflict and rethrows anything else', async () => {
    repository.insert.mockRejectedValue(Object.assign(new Error('duplicate'), { cause: { code: '23505' } }));
    await expect(service.create(5, { username: 'mihon', password: 'password123' })).rejects.toThrow(ConflictException);
    repository.insert.mockRejectedValue(new Error('connection lost'));
    await expect(service.create(5, { username: 'mihon', password: 'password123' })).rejects.toThrow('connection lost');
  });

  it('updates only the provided options for accounts the caller owns', async () => {
    await expect(service.update(5, 7, { includeNonComicBooks: true })).resolves.toMatchObject({ includeNonComicBooks: true });
    expect(repository.findOwned).toHaveBeenCalledWith(5, 7);
    expect(repository.updateOptions).toHaveBeenCalledWith(7, { includeNonComicBooks: true });

    await expect(service.update(5, 7, {})).rejects.toThrow(BadRequestException);

    repository.findOwned.mockResolvedValue(null);
    await expect(service.update(6, 7, { groupUnknownSeries: false })).rejects.toThrow(ForbiddenException);
    expect(repository.updateOptions).toHaveBeenCalledTimes(1);
  });

  it('reports a vanished account as not found after the ownership check', async () => {
    repository.updateOptions.mockResolvedValue(null);
    await expect(service.update(5, 7, { groupUnknownSeries: false })).rejects.toThrow(NotFoundException);
  });

  it('deletes owned accounts and drops their cached credentials', async () => {
    await service.delete(5, 7);
    expect(repository.deleteById).toHaveBeenCalledWith(7);
    expect(credentialCache.invalidateAccount).toHaveBeenCalledWith(KOMGA_BASIC_REALM, 7);

    repository.findOwned.mockResolvedValue(null);
    await expect(service.delete(6, 7)).rejects.toThrow(ForbiddenException);
    expect(repository.deleteById).toHaveBeenCalledTimes(1);
  });

  it('validates credentials against the stored hash', async () => {
    await expect(service.validateCredentials('mihon', 'password123')).resolves.toEqual(ACCOUNT);
    await expect(service.validateCredentials('mihon', 'wrong')).resolves.toBeNull();
    repository.findByUsername.mockResolvedValue(null);
    await expect(service.validateCredentials('nobody', 'password123')).resolves.toBeNull();
    repository.findById.mockResolvedValue(null);
    await expect(service.findById(7)).resolves.toBeNull();
  });
});
