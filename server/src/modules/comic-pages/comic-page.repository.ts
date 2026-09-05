import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class ComicPageRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async updatePageCount(fileId: number, pageCount: number | null): Promise<void> {
    // Avoid changing updatedAt when the count is unchanged; KOReader and OPDS use that timestamp.
    await this.db
      .update(schema.bookFiles)
      .set({ pageCount })
      .where(and(eq(schema.bookFiles.id, fileId), sql`${schema.bookFiles.pageCount} is distinct from ${pageCount}`));
  }
}
