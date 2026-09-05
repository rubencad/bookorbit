import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateKomgaUserDto } from './create-komga-user.dto';
import { UpdateKomgaUserDto } from './update-komga-user.dto';

describe('Komga user DTOs', () => {
  it('accepts valid create and update payloads', async () => {
    const createDto = plainToInstance(CreateKomgaUserDto, { username: 'mihon-phone', password: 'password123', groupUnknownSeries: false });
    const updateDto = plainToInstance(UpdateKomgaUserDto, { includeNonComicBooks: true });

    expect(await validate(createDto)).toEqual([]);
    expect(await validate(updateDto)).toEqual([]);
  });

  it('rejects short usernames, short passwords and non-boolean options', async () => {
    const badCreate = plainToInstance(CreateKomgaUserDto, { username: 'ab', password: 'short', includeNonComicBooks: 'yes' });
    const badUpdate = plainToInstance(UpdateKomgaUserDto, { groupUnknownSeries: 'no' });

    const createErrors = await validate(badCreate);
    expect(createErrors.map((error) => error.property).sort()).toEqual(['includeNonComicBooks', 'password', 'username']);
    expect((await validate(badUpdate)).map((error) => error.property)).toEqual(['groupUnknownSeries']);
  });
});
