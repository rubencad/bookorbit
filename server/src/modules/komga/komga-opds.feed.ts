import { basename, extname } from 'path';

import { OPDS_PSE_NAMESPACE, OPDS_PSE_STREAM_REL, pseStreamFormat, pseStreamType } from '../opds/opds-pse';
import { esc, OPDS_MIME_ACQ, OPDS_MIME_NAV, OPDS_MIME_SEARCH, toRfc3339Seconds, xmlEl, xmlLink } from '../opds/opds-xml.helpers';
import type { KomgaBookRecord, KomgaLibraryRecord, KomgaSeriesAggregate, KomgaSeriesRecord } from './komga-catalog.types';
import { formatSeriesId } from './komga-ids';
import type { KomgaPageRequest } from './komga-page-response';
import { humanizeBytes, komgaMediaFor, komgaMediaType, komgaReadProgressFor, type KomgaReadProgress } from './komga.mapper';

export const KOMGA_OPDS_BASE = '/komga/opds/v1.2';
export const KOMGA_OPDS_SEARCH_TEMPLATE = `${KOMGA_OPDS_BASE}/series?search={searchTerms}`;

function latestDate(first: Date, ...others: Array<Date | null>): Date {
  let latest = first;
  for (const candidate of others) {
    if (candidate && candidate > latest) latest = candidate;
  }
  return latest;
}

// Panels enables Komga REST integration only when the OPDS author is named Komga.
// Keep the author URI branded as BookOrbit.
const FEED_AUTHOR = ['<author>', `  ${xmlEl('name', 'Komga')}`, `  ${xmlEl('uri', 'https://bookorbit.app')}`, '</author>'].join('\n');

export interface KomgaOpdsPageInfo {
  page: KomgaPageRequest;
  total: number;
}

interface FeedOptions {
  kind: 'navigation' | 'acquisition';
  id: string;
  title: string;
  selfPath: string;
  entries: string[];
  updated?: Date;
  extraLinks?: string[];
  paging?: KomgaOpdsPageInfo;
}

function feedMime(kind: FeedOptions['kind']): string {
  return kind === 'navigation' ? OPDS_MIME_NAV : OPDS_MIME_ACQ;
}

function pagedPath(selfPath: string, pageNumber: number): string {
  const url = new URL(selfPath, 'http://localhost');
  url.searchParams.set('page', String(pageNumber));
  return `${url.pathname}?${url.searchParams.toString()}`;
}

function pagingLinks(selfPath: string, kind: FeedOptions['kind'], paging: KomgaOpdsPageInfo): string[] {
  const links: string[] = [];
  const totalPages = Math.ceil(paging.total / paging.page.size);
  if (paging.page.page > 0) {
    links.push(xmlLink('previous', pagedPath(selfPath, paging.page.page - 1), feedMime(kind)));
  }
  if (paging.page.page < totalPages - 1) {
    links.push(xmlLink('next', pagedPath(selfPath, paging.page.page + 1), feedMime(kind)));
  }
  return links;
}

export function komgaOpdsFeed(options: FeedOptions): string {
  const mime = feedMime(options.kind);
  const links = [
    xmlLink('self', options.selfPath, mime),
    xmlLink('start', `${KOMGA_OPDS_BASE}/catalog`, OPDS_MIME_NAV),
    ...(options.extraLinks ?? []),
    ...(options.paging ? pagingLinks(options.selfPath, options.kind, options.paging) : []),
  ];

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom"',
    '      xmlns:opds="http://opds-spec.org/2010/catalog"',
    '      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"',
    `      xmlns:pse="${OPDS_PSE_NAMESPACE}">`,
    `  ${xmlEl('id', options.id)}`,
    `  ${xmlEl('title', options.title)}`,
    `  ${xmlEl('updated', toRfc3339Seconds(options.updated ?? new Date()))}`,
    ...FEED_AUTHOR.split('\n').map((line) => `  ${line}`),
  ];

  if (options.paging) {
    lines.push(`  ${xmlEl('opensearch:totalResults', String(options.paging.total))}`);
    lines.push(`  ${xmlEl('opensearch:itemsPerPage', String(options.paging.page.size))}`);
    lines.push(`  ${xmlEl('opensearch:startIndex', String(options.paging.page.offset))}`);
  }

  for (const link of links) lines.push(`  ${link}`);
  for (const entry of options.entries) lines.push(entry);

  lines.push('</feed>');
  return lines.join('\n');
}

export function komgaOpdsNavEntry(id: string, title: string, href: string, updated: Date, content = ''): string {
  return [
    '  <entry>',
    `    ${xmlEl('title', title)}`,
    `    ${xmlEl('id', id)}`,
    `    ${xmlEl('updated', toRfc3339Seconds(updated))}`,
    `    <content type="text">${esc(content)}</content>`,
    `    ${xmlLink('subsection', href, OPDS_MIME_NAV)}`,
    '  </entry>',
  ].join('\n');
}

export function komgaOpdsLibraryEntry(library: KomgaLibraryRecord): string {
  return komgaOpdsNavEntry(String(library.id), library.name, `${KOMGA_OPDS_BASE}/libraries/${library.id}`, library.updatedAt);
}

// Match Komga's navigation media type even though the target is an acquisition feed.
export function komgaOpdsSeriesEntry(series: KomgaSeriesRecord, aggregate: KomgaSeriesAggregate | undefined): string {
  const id = formatSeriesId(series.key);
  return komgaOpdsNavEntry(id, series.name, `${KOMGA_OPDS_BASE}/series/${id}`, series.updatedAt, aggregate?.summary ?? '');
}

function pageStreamLink(book: KomgaBookRecord, progress: KomgaReadProgress | null): string | null {
  const pageCount = book.file.pageCount ?? 0;
  if (komgaMediaFor(book.file.format).mediaProfile !== 'DIVINA' || pageCount <= 0) return null;

  const attributes: Record<string, string> = { 'pse:count': String(pageCount) };
  if (progress && progress.page > 0) {
    attributes['pse:lastRead'] = String(Math.min(progress.page, pageCount));
    attributes['pse:lastReadDate'] = toRfc3339Seconds(progress.readAt);
  }
  const format = pseStreamFormat(book.file.pageMediaType);
  const href = `${KOMGA_OPDS_BASE}/books/${book.id}/pages/{pageNumber}?convert=${format}`;
  return xmlLink(OPDS_PSE_STREAM_REL, href, pseStreamType(format), undefined, attributes);
}

export function komgaOpdsBookEntry(book: KomgaBookRecord, prependSeries = false): string {
  const title = prependSeries ? `${book.series.name} ${book.series.number}: ${book.title}` : book.title;
  const extension = extname(book.file.absolutePath).replace('.', '').toLowerCase() || book.file.format.toLowerCase();
  const summary = book.description?.trim();
  const content = summary
    ? `${extension} - ${humanizeBytes(book.file.sizeBytes ?? 0)}\n\n${summary}`
    : `${extension} - ${humanizeBytes(book.file.sizeBytes ?? 0)}`;
  const progress = komgaReadProgressFor(book);
  // Bump the entry timestamp when reading state changes so cached clients refresh pse:lastRead.
  const { progressUpdatedAt, statusUpdatedAt, resetAt } = book.readState;
  const updated = latestDate(book.updatedAt, progressUpdatedAt, statusUpdatedAt, resetAt);

  const lines = [
    '  <entry>',
    `    ${xmlEl('title', title)}`,
    `    ${xmlEl('id', String(book.id))}`,
    `    ${xmlEl('updated', toRfc3339Seconds(updated))}`,
    `    <content type="text">${esc(content)}</content>`,
  ];

  for (const author of book.authors) {
    lines.push(`    <author>${xmlEl('name', author.name)}</author>`);
  }

  lines.push(`    ${xmlLink('http://opds-spec.org/image/thumbnail', `${KOMGA_OPDS_BASE}/books/${book.id}/thumbnail/small`, 'image/jpeg')}`);
  lines.push(`    ${xmlLink('http://opds-spec.org/image', `${KOMGA_OPDS_BASE}/books/${book.id}/thumbnail`, 'image/jpeg')}`);

  const fileName = basename(book.file.absolutePath).replace(/;/g, '');
  lines.push(
    `    ${xmlLink('http://opds-spec.org/acquisition', `${KOMGA_OPDS_BASE}/books/${book.id}/file/${encodeURIComponent(fileName)}`, komgaMediaType(book.file.format))}`,
  );

  const stream = pageStreamLink(book, progress);
  if (stream) lines.push(`    ${stream}`);

  lines.push('  </entry>');
  return lines.join('\n');
}

export function komgaOpdsSearchDescription(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">',
    `  ${xmlEl('ShortName', 'BookOrbit')}`,
    `  ${xmlEl('Description', 'Search series in the BookOrbit Komga catalog')}`,
    `  <Url type="${esc(OPDS_MIME_NAV)}" template="${esc(KOMGA_OPDS_SEARCH_TEMPLATE)}"/>`,
    '  <InputEncoding>UTF-8</InputEncoding>',
    '  <OutputEncoding>UTF-8</OutputEncoding>',
    '</OpenSearchDescription>',
  ].join('\n');
}

export function komgaOpdsSearchLink(): string {
  return xmlLink('search', `${KOMGA_OPDS_BASE}/search`, OPDS_MIME_SEARCH);
}
