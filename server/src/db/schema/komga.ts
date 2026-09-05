import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';

export const komgaUsers = pgTable(
  'komga_users',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    username: varchar('username', { length: 100 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    groupUnknownSeries: boolean('group_unknown_series').notNull().default(true),
    includeNonComicBooks: boolean('include_non_comic_books').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [uniqueIndex('komga_users_username_lower_uidx').on(sql`lower(${t.username})`), index('komga_users_user_id_idx').on(t.userId)],
);
