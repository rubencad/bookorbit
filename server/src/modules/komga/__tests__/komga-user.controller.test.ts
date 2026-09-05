import { KomgaUserController } from '../komga-user.controller';

describe('KomgaUserController', () => {
  it('delegates account management to the service scoped to the current user', async () => {
    const service = {
      findAllForUser: vi.fn().mockResolvedValue('all'),
      create: vi.fn().mockResolvedValue('created'),
      update: vi.fn().mockResolvedValue('updated'),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new KomgaUserController(service as never);
    const user = { id: 5 } as never;

    await expect(controller.findAll(user)).resolves.toBe('all');
    await expect(controller.create(user, { username: 'mihon', password: 'password123' })).resolves.toBe('created');
    await expect(controller.update(user, 11, { includeNonComicBooks: true })).resolves.toBe('updated');
    await expect(controller.delete(user, 11)).resolves.toBeUndefined();

    expect(service.findAllForUser).toHaveBeenCalledWith(5);
    expect(service.create).toHaveBeenCalledWith(5, { username: 'mihon', password: 'password123' });
    expect(service.update).toHaveBeenCalledWith(5, 11, { includeNonComicBooks: true });
    expect(service.delete).toHaveBeenCalledWith(5, 11);
  });
});
