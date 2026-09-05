import { BadRequestException } from '@nestjs/common';

import { MAX_OFFSET_ROWS, isOffsetWithinLimit } from '../../common/constants/pagination.constants';
import { KOMGA_MAX_PAGE_SIZE, KOMGA_UNPAGED_MAX_ROWS } from './komga.constants';

export type KomgaSortDirection = 'asc' | 'desc';

export interface KomgaSort {
  property: string;
  direction: KomgaSortDirection;
}

export interface KomgaPageRequest {
  page: number;
  size: number;
  offset: number;
  unpaged: boolean;
  sort: KomgaSort[];
}

export interface KomgaPageQuery {
  page?: number;
  size?: number;
  sort?: string[];
  unpaged?: boolean;
}

interface SpringSort {
  empty: boolean;
  sorted: boolean;
  unsorted: boolean;
}

export interface KomgaPage<T> {
  content: T[];
  pageable: {
    sort: SpringSort;
    offset: number;
    pageNumber: number;
    pageSize: number;
    paged: boolean;
    unpaged: boolean;
  };
  last: boolean;
  totalPages: number;
  totalElements: number;
  size: number;
  number: number;
  sort: SpringSort;
  first: boolean;
  numberOfElements: number;
  empty: boolean;
}

export interface ResolvePageRequestOptions {
  defaultSort: KomgaSort[];
  sortableProperties: readonly string[];
  allowUnpaged?: boolean;
  unpagedMaxRows?: number;
  defaultSize?: number;
}

export function parseSortParams(values: readonly string[] | undefined, sortableProperties: readonly string[]): KomgaSort[] {
  const sorts: KomgaSort[] = [];
  for (const value of values ?? []) {
    const [property, rawDirection] = value.split(',').map((part) => part.trim());
    if (!property || !sortableProperties.includes(property)) continue;
    const direction: KomgaSortDirection = rawDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
    sorts.push({ property, direction });
  }
  return sorts;
}

export function resolvePageRequest(query: KomgaPageQuery, options: ResolvePageRequestOptions): KomgaPageRequest {
  const parsedSort = parseSortParams(query.sort, options.sortableProperties);
  const sort = parsedSort.length > 0 ? parsedSort : options.defaultSort;

  const unpagedMaxRows = options.unpagedMaxRows ?? KOMGA_UNPAGED_MAX_ROWS;
  if (query.unpaged && options.allowUnpaged) {
    return { page: 0, size: unpagedMaxRows, offset: 0, unpaged: true, sort };
  }

  const maxSize = options.allowUnpaged ? unpagedMaxRows : KOMGA_MAX_PAGE_SIZE;
  const page = Math.max(query.page ?? 0, 0);
  const requestedSize = query.unpaged ? KOMGA_MAX_PAGE_SIZE : (query.size ?? options.defaultSize ?? 20);
  const size = Math.min(Math.max(requestedSize, 1), maxSize);
  const offset = page * size;
  if (!isOffsetWithinLimit(offset)) {
    throw new BadRequestException(`pagination window is too deep; page * size must be <= ${MAX_OFFSET_ROWS}`);
  }
  return { page, size, offset, unpaged: false, sort };
}

export function buildKomgaPage<T>(content: T[], request: KomgaPageRequest, totalElements: number): KomgaPage<T> {
  const sort: SpringSort = { empty: request.sort.length === 0, sorted: request.sort.length > 0, unsorted: request.sort.length === 0 };

  // Mark capped unpaged results as page 0 so `last` remains false.
  if (request.unpaged && totalElements <= content.length) {
    return {
      content,
      pageable: { sort, offset: 0, pageNumber: 0, pageSize: Math.max(content.length, 1), paged: false, unpaged: true },
      last: true,
      totalPages: 1,
      totalElements,
      size: content.length,
      number: 0,
      sort,
      first: true,
      numberOfElements: content.length,
      empty: content.length === 0,
    };
  }

  const totalPages = Math.ceil(totalElements / request.size);
  return {
    content,
    pageable: { sort, offset: request.offset, pageNumber: request.page, pageSize: request.size, paged: true, unpaged: false },
    last: request.page >= totalPages - 1,
    totalPages,
    totalElements,
    size: request.size,
    number: request.page,
    sort,
    first: request.page === 0,
    numberOfElements: content.length,
    empty: content.length === 0,
  };
}

export function emptyKomgaPage<T>(): KomgaPage<T> {
  return buildKomgaPage<T>([], { page: 0, size: 20, offset: 0, unpaged: false, sort: [] }, 0);
}
