import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export type KomgaUserRow = typeof schema.komgaUsers.$inferSelect;
export type NewKomgaUserRow = typeof schema.komgaUsers.$inferInsert;
export type KomgaUserOptions = Partial<Pick<KomgaUserRow, 'groupUnknownSeries' | 'includeNonComicBooks'>>;

const PUBLIC_COLUMNS = {
  id: schema.komgaUsers.id,
  userId: schema.komgaUsers.userId,
  username: schema.komgaUsers.username,
  groupUnknownSeries: schema.komgaUsers.groupUnknownSeries,
  includeNonComicBooks: schema.komgaUsers.includeNonComicBooks,
  createdAt: schema.komgaUsers.createdAt,
};

@Injectable()
export class KomgaUserRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAllForUser(userId: number) {
    return this.db.select(PUBLIC_COLUMNS).from(schema.komgaUsers).where(eq(schema.komgaUsers.userId, userId)).orderBy(schema.komgaUsers.username);
  }

  async insert(values: NewKomgaUserRow) {
    const [created] = await this.db.insert(schema.komgaUsers).values(values).returning(PUBLIC_COLUMNS);
    return created;
  }

  async updateOptions(komgaUserId: number, options: KomgaUserOptions) {
    const [updated] = await this.db.update(schema.komgaUsers).set(options).where(eq(schema.komgaUsers.id, komgaUserId)).returning(PUBLIC_COLUMNS);
    return updated ?? null;
  }

  async deleteById(komgaUserId: number): Promise<void> {
    await this.db.delete(schema.komgaUsers).where(eq(schema.komgaUsers.id, komgaUserId));
  }

  async findById(komgaUserId: number): Promise<KomgaUserRow | null> {
    const row = await this.db.query.komgaUsers.findFirst({ where: eq(schema.komgaUsers.id, komgaUserId) });
    return row ?? null;
  }

  async findByUsername(username: string): Promise<KomgaUserRow | null> {
    const row = await this.db.query.komgaUsers.findFirst({ where: eq(schema.komgaUsers.username, username) });
    return row ?? null;
  }

  async findOwned(userId: number, komgaUserId: number): Promise<KomgaUserRow | null> {
    const row = await this.db.query.komgaUsers.findFirst({
      where: and(eq(schema.komgaUsers.id, komgaUserId), eq(schema.komgaUsers.userId, userId)),
    });
    return row ?? null;
  }
}
