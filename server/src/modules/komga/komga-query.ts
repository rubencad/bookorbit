import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export type KomgaRawQuery = Record<string, string | string[] | undefined>;

function toStringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toRawList(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) => String(entry).trim()).filter(Boolean);
}

function toIdList(value: unknown): unknown {
  const list = toStringList(value);
  return list?.map((entry) => (/^\d{1,9}$/.test(entry) ? Number(entry) : entry));
}

function toBoolean(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  const single = Array.isArray(value) ? value[value.length - 1] : value;
  if (single === 'true' || single === '1' || single === true) return true;
  if (single === 'false' || single === '0' || single === false) return false;
  return single;
}

function toSingle(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  return Array.isArray(value) ? value[value.length - 1] : value;
}

const stringList = z.preprocess(toStringList, z.array(z.string().max(500)).optional());
const rawList = z.preprocess(toRawList, z.array(z.string().max(500)).optional());
const idList = z.preprocess(toIdList, z.array(z.number().int().positive()).optional());
const flag = z.preprocess(toBoolean, z.boolean().optional());
const singleString = z.preprocess(toSingle, z.string().max(500).optional());
const pageNumber = z.preprocess(toSingle, z.coerce.number().int().min(0).optional());
const pageSize = z.preprocess(toSingle, z.coerce.number().int().min(1).optional());

const pageQuery = {
  page: pageNumber,
  size: pageSize,
  sort: rawList,
  unpaged: flag,
};

export const seriesListQuerySchema = z.object({
  ...pageQuery,
  search: singleString,
  library_id: idList,
  status: stringList,
  genre: stringList,
  tag: stringList,
  publisher: stringList,
  language: stringList,
  author: stringList,
  deleted: flag,
  oneshot: flag,
});
export type SeriesListQuery = z.infer<typeof seriesListQuerySchema>;

export const seriesBooksQuerySchema = z.object({
  ...pageQuery,
  media_status: stringList,
  tag: stringList,
  deleted: flag,
});
export type SeriesBooksQuery = z.infer<typeof seriesBooksQuerySchema>;

export const bookListQuerySchema = z.object({
  ...pageQuery,
  search: singleString,
  library_id: idList,
  media_status: stringList,
  tag: stringList,
  author: stringList,
  deleted: flag,
});
export type BookListQuery = z.infer<typeof bookListQuerySchema>;

export const pageImageQuerySchema = z.object({
  convert: z.preprocess(toSingle, z.enum(['jpeg', 'png']).optional()),
  zero_based: flag,
});
export type PageImageQuery = z.infer<typeof pageImageQuerySchema>;

export const opdsFeedQuerySchema = z.object({
  page: pageNumber,
  size: pageSize,
  search: singleString,
});
export type OpdsFeedQuery = z.infer<typeof opdsFeedQuerySchema>;

export const opdsPageImageQuerySchema = z.object({
  convert: z.preprocess(toSingle, z.enum(['jpeg', 'png']).optional()),
});
export type OpdsPageImageQuery = z.infer<typeof opdsPageImageQuerySchema>;

export const referentialQuerySchema = z.object({
  library_id: idList,
  search: singleString,
});
export type ReferentialQuery = z.infer<typeof referentialQuerySchema>;

export const referentialPageQuerySchema = z.object({
  ...pageQuery,
  library_id: idList,
  search: singleString,
  role: singleString,
});
export type ReferentialPageQuery = z.infer<typeof referentialPageQuerySchema>;

export const emptyPageQuerySchema = z.object(pageQuery);

export function parseKomgaQuery<T>(schema: z.ZodType<T>, query: KomgaRawQuery | undefined): T {
  const result = schema.safeParse(query ?? {});
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue?.path.join('.') || 'query';
  throw new BadRequestException(`Invalid query parameter ${field}: ${issue?.message ?? 'invalid value'}`);
}
