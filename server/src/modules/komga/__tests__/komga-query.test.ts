import { BadRequestException } from '@nestjs/common';

import { bookListQuerySchema, pageImageQuerySchema, parseKomgaQuery, referentialQuerySchema, seriesListQuerySchema } from '../komga-query';

describe('komga query parsing', () => {
  it('accepts comma joined and repeated list parameters', () => {
    expect(parseKomgaQuery(seriesListQuerySchema, { library_id: '1,2', genre: ['a', 'b,c'] })).toMatchObject({
      library_id: [1, 2],
      genre: ['a', 'b', 'c'],
    });
    expect(parseKomgaQuery(seriesListQuerySchema, { library_id: ['3', '4'] }).library_id).toEqual([3, 4]);
  });

  it('keeps sort values whole because their direction follows a comma', () => {
    expect(parseKomgaQuery(seriesListQuerySchema, { sort: 'metadata.titleSort,desc' }).sort).toEqual(['metadata.titleSort,desc']);
    expect(parseKomgaQuery(seriesListQuerySchema, { sort: ['createdDate,desc', 'name,asc'] }).sort).toEqual(['createdDate,desc', 'name,asc']);
  });

  it('coerces booleans and numbers and rejects garbage with a 400', () => {
    expect(parseKomgaQuery(seriesListQuerySchema, { deleted: 'false', oneshot: 'true', page: '2', size: '50' })).toMatchObject({
      deleted: false,
      oneshot: true,
      page: 2,
      size: 50,
    });
    expect(() => parseKomgaQuery(seriesListQuerySchema, { library_id: 'abc' })).toThrow(BadRequestException);
    expect(() => parseKomgaQuery(seriesListQuerySchema, { size: '0' })).toThrow(BadRequestException);
    expect(() => parseKomgaQuery(seriesListQuerySchema, { page: '-1' })).toThrow(BadRequestException);
    expect(() => parseKomgaQuery(seriesListQuerySchema, { deleted: 'maybe' })).toThrow(BadRequestException);
    expect(() => parseKomgaQuery(seriesListQuerySchema, { library_id: 'abc' })).toThrow(/library_id/);
  });

  it('drops parameters Komga clients send that this server does not model', () => {
    const parsed = parseKomgaQuery(bookListQuerySchema, { search: 'x', read_status: 'UNREAD', released_after: '2020-01-01' }) as Record<
      string,
      unknown
    >;
    expect(parsed).toEqual({ search: 'x' });
  });

  it('validates page image conversion targets', () => {
    expect(parseKomgaQuery(pageImageQuerySchema, { convert: 'png', zero_based: 'true' })).toEqual({ convert: 'png', zero_based: true });
    expect(() => parseKomgaQuery(pageImageQuerySchema, { convert: 'gif' })).toThrow(BadRequestException);
    expect(parseKomgaQuery(referentialQuerySchema, undefined)).toEqual({});
  });
});
