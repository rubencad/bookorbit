import { BadRequestException } from '@nestjs/common';

import { MAX_OFFSET_ROWS } from '../../../common/constants/pagination.constants';
import { buildKomgaPage, emptyKomgaPage, parseSortParams, resolvePageRequest } from '../komga-page-response';
import { KOMGA_MAX_PAGE_SIZE, KOMGA_UNPAGED_MAX_ROWS } from '../komga.constants';

const SORTABLE = ['metadata.titleSort', 'createdDate'];
const DEFAULT_SORT = [{ property: 'metadata.titleSort', direction: 'asc' as const }];

describe('komga page response', () => {
  describe('parseSortParams', () => {
    it('keeps known properties, defaults the direction and drops unknown ones', () => {
      expect(parseSortParams(['metadata.titleSort,desc', 'createdDate', 'relevance,asc', 'bogus'], SORTABLE)).toEqual([
        { property: 'metadata.titleSort', direction: 'desc' },
        { property: 'createdDate', direction: 'asc' },
      ]);
      expect(parseSortParams(undefined, SORTABLE)).toEqual([]);
    });
  });

  describe('resolvePageRequest', () => {
    it('defaults to the first page of twenty with the default sort', () => {
      expect(resolvePageRequest({}, { defaultSort: DEFAULT_SORT, sortableProperties: SORTABLE })).toEqual({
        page: 0,
        size: 20,
        offset: 0,
        unpaged: false,
        sort: DEFAULT_SORT,
      });
    });

    it('clamps the size and computes the offset from the zero based page', () => {
      const request = resolvePageRequest({ page: 3, size: 9_999 }, { defaultSort: DEFAULT_SORT, sortableProperties: SORTABLE });
      expect(request.size).toBe(KOMGA_MAX_PAGE_SIZE);
      expect(request.offset).toBe(3 * KOMGA_MAX_PAGE_SIZE);
    });

    it('treats unpaged as the maximum page size unless the route allows unpaged results', () => {
      const capped = resolvePageRequest({ unpaged: true, size: 5 }, { defaultSort: DEFAULT_SORT, sortableProperties: SORTABLE });
      expect(capped).toMatchObject({ unpaged: false, size: KOMGA_MAX_PAGE_SIZE, page: 0 });

      const unpaged = resolvePageRequest({ unpaged: true }, { defaultSort: DEFAULT_SORT, sortableProperties: SORTABLE, allowUnpaged: true });
      expect(unpaged).toMatchObject({ unpaged: true, size: KOMGA_UNPAGED_MAX_ROWS, offset: 0 });
    });

    it('allows page sizes up to the unpaged cap', () => {
      const request = resolvePageRequest(
        { page: 1, size: KOMGA_UNPAGED_MAX_ROWS },
        { defaultSort: DEFAULT_SORT, sortableProperties: SORTABLE, allowUnpaged: true },
      );
      expect(request).toMatchObject({ page: 1, size: KOMGA_UNPAGED_MAX_ROWS, offset: KOMGA_UNPAGED_MAX_ROWS, unpaged: false });
      expect(resolvePageRequest({ size: 9_999 }, { defaultSort: DEFAULT_SORT, sortableProperties: SORTABLE, allowUnpaged: true }).size).toBe(
        KOMGA_UNPAGED_MAX_ROWS,
      );
    });

    it('uses a route-specific unpaged cap', () => {
      const options = { defaultSort: DEFAULT_SORT, sortableProperties: SORTABLE, allowUnpaged: true, unpagedMaxRows: 2_000 };
      expect(resolvePageRequest({ unpaged: true }, options)).toMatchObject({ unpaged: true, size: 2_000 });
      expect(resolvePageRequest({ size: 4_000 }, options).size).toBe(2_000);
    });

    it('rejects offsets beyond the shared pagination limit', () => {
      const page = Math.ceil(MAX_OFFSET_ROWS / KOMGA_MAX_PAGE_SIZE) + 1;
      expect(() => resolvePageRequest({ page, size: KOMGA_MAX_PAGE_SIZE }, { defaultSort: DEFAULT_SORT, sortableProperties: SORTABLE })).toThrow(
        BadRequestException,
      );
    });
  });

  describe('buildKomgaPage', () => {
    it('sets Spring metadata for first, middle, and last pages', () => {
      const first = buildKomgaPage(['a', 'b'], { page: 0, size: 2, offset: 0, unpaged: false, sort: DEFAULT_SORT }, 5);
      expect(first).toMatchObject({
        first: true,
        last: false,
        totalPages: 3,
        totalElements: 5,
        number: 0,
        size: 2,
        numberOfElements: 2,
        empty: false,
      });
      expect(first.pageable).toEqual({
        sort: { empty: false, sorted: true, unsorted: false },
        offset: 0,
        pageNumber: 0,
        pageSize: 2,
        paged: true,
        unpaged: false,
      });

      const middle = buildKomgaPage(['c', 'd'], { page: 1, size: 2, offset: 2, unpaged: false, sort: DEFAULT_SORT }, 5);
      expect(middle).toMatchObject({ first: false, last: false, number: 1 });

      const last = buildKomgaPage(['e'], { page: 2, size: 2, offset: 4, unpaged: false, sort: DEFAULT_SORT }, 5);
      expect(last).toMatchObject({ first: false, last: true, numberOfElements: 1 });
    });

    it('reports unpaged results as a single unpaged page', () => {
      const page = buildKomgaPage([1, 2, 3], { page: 0, size: KOMGA_UNPAGED_MAX_ROWS, offset: 0, unpaged: true, sort: [] }, 3);
      expect(page).toMatchObject({ totalPages: 1, size: 3, first: true, last: true, sort: { empty: true, sorted: false, unsorted: true } });
      expect(page.pageable).toMatchObject({ paged: false, unpaged: true, pageSize: 3 });
    });

    it('marks a capped unpaged result as page 0', () => {
      const content = Array.from({ length: KOMGA_UNPAGED_MAX_ROWS }, (_, index) => index);
      const page = buildKomgaPage(content, { page: 0, size: KOMGA_UNPAGED_MAX_ROWS, offset: 0, unpaged: true, sort: [] }, KOMGA_UNPAGED_MAX_ROWS + 1);
      expect(page).toMatchObject({
        totalElements: KOMGA_UNPAGED_MAX_ROWS + 1,
        totalPages: 2,
        size: KOMGA_UNPAGED_MAX_ROWS,
        number: 0,
        first: true,
        last: false,
      });
      expect(page.pageable).toMatchObject({ paged: true, unpaged: false, pageNumber: 0, pageSize: KOMGA_UNPAGED_MAX_ROWS });
    });

    it('marks an empty page as first and last', () => {
      expect(emptyKomgaPage()).toMatchObject({ content: [], totalElements: 0, totalPages: 0, first: true, last: true, empty: true });
    });
  });
});
