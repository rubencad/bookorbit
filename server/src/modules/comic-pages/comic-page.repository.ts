import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { COMIC_CONTAINER_FORMATS } from '../../common/comic-format-detect';
import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class ComicPageRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findFilesMissingPageInfo(libraryFolderId: number, limit: number) {
    return this.db
      .select({
        id: schema.bookFiles.id,
        absolutePath: schema.bookFiles.absolutePath,
        format: schema.bookFiles.format,
        pageCount: schema.bookFiles.pageCount,
        pageMediaType: schema.bookFiles.pageMediaType,
      })
      .from(schema.bookFiles)
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .where(
        and(
          eq(schema.bookFiles.libraryFolderId, libraryFolderId),
          eq(schema.bookFiles.role, 'content'),
          inArray(schema.bookFiles.format, [...COMIC_CONTAINER_FORMATS]),
          or(isNull(schema.bookFiles.pageCount), isNull(schema.bookFiles.pageMediaType)),
          eq(schema.books.status, 'present'),
        ),
      )
      .orderBy(sql`random()`)
      .limit(limit);
  }

  async updatePageCount(fileId: number, pageCount: number | null, pageMediaType: string | null): Promise<void> {
    // Do not bump updatedAt when derived page metadata is unchanged; it is used by some clients as a content version.
    await this.db
      .update(schema.bookFiles)
      .set({ pageCount, pageMediaType })
      .where(
        and(
          eq(schema.bookFiles.id, fileId),
          sql`(${schema.bookFiles.pageCount} is distinct from ${pageCount} or ${schema.bookFiles.pageMediaType} is distinct from ${pageMediaType})`,
        ),
      );
  }
}
