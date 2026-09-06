import type { ContentFilterRules, ReadStatus, ReadStatusSource } from '@bookorbit/types';

import type { KomgaSeriesKey } from './komga-ids';
import type { KomgaAuthorRole } from './komga.constants';

export interface KomgaScope {
  userId: number;
  isSuperuser: boolean;
  contentFilters: ContentFilterRules;
  includeNonComicBooks: boolean;
  groupUnknownSeries: boolean;
  libraryIds: number[];
}

export interface KomgaLibraryRecord {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface KomgaSeriesRecord {
  key: KomgaSeriesKey;
  name: string;
  booksCount: number;
  booksReadCount: number;
  booksInProgressCount: number;
  createdAt: Date;
  updatedAt: Date;
  expectedBookCount: number | null;
}

export interface KomgaAuthorRef {
  name: string;
  role: KomgaAuthorRole;
}

export interface KomgaSeriesAggregate {
  lowestBookId: number | null;
  summary: string;
  summaryNumber: string;
  publisher: string | null;
  language: string | null;
  releaseDate: string | null;
  genres: string[];
  tags: string[];
  authors: KomgaAuthorRef[];
}

export interface KomgaBookFileRecord {
  id: number;
  format: string;
  absolutePath: string;
  sizeBytes: number | null;
  mtime: Date | null;
  updatedAt: Date;
  fileHash: string | null;
  pageCount: number | null;
  pageMediaType: string | null;
}

export interface KomgaBookSeriesContext {
  key: KomgaSeriesKey;
  name: string;
  number: string;
  numberSort: number;
}

export interface KomgaBookReadState {
  status: ReadStatus | null;
  statusSource: ReadStatusSource | null;
  finishedAt: Date | null;
  statusUpdatedAt: Date | null;
  pageNumber: number | null;
  percentage: number | null;
  lastReadAt: Date | null;
  progressUpdatedAt: Date | null;
  resetAt: Date | null;
}

export interface KomgaBookRecord {
  id: number;
  libraryId: number;
  title: string;
  addedAt: Date;
  updatedAt: Date;
  metadataUpdatedAt: Date | null;
  description: string | null;
  publishedDate: string | null;
  isbn10: string | null;
  isbn13: string | null;
  file: KomgaBookFileRecord;
  series: KomgaBookSeriesContext;
  authors: KomgaAuthorRef[];
  tags: string[];
  readState: KomgaBookReadState;
}

export interface KomgaSeriesNumbering {
  indexedCount: number;
  maxIndex: number;
  ordinals: Map<number, number>;
}
