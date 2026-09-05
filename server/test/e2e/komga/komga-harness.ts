import { randomUUID } from 'crypto';
import { hash } from 'bcryptjs';

import * as schema from '../../../src/db/schema';
import { GLOBAL_PREFIX_EXCLUDED_ROUTES } from '../../../src/common/utils/bootstrap.utils';
import { createOpdsE2EContext, setSetting, type OpdsE2EContext } from '../opds/opds-harness';

export type KomgaE2EContext = OpdsE2EContext;

export {
  authHeader,
  basicAuth,
  closeOpdsE2EContext as closeKomgaE2EContext,
  createBookCoverArtifacts,
  createLibraryWithFolder,
  createUserAndLogin,
  grantLibraryAccess,
  locateBookByAbsolutePath,
  replaceUserPermissions,
  setSetting,
  setUserActive,
  triggerAndWaitForLibraryScan,
  type CreatedLibrary,
  type LocatedBookFile,
  type TestUserSession,
} from '../opds/opds-harness';

export async function createKomgaE2EContext(): Promise<KomgaE2EContext> {
  const ctx = await createOpdsE2EContext({ excludeFromGlobalPrefix: GLOBAL_PREFIX_EXCLUDED_ROUTES });
  await setSetting(ctx, 'komga_api_enabled', 'true');
  return ctx;
}

export async function createKomgaUserCredential(
  ctx: KomgaE2EContext,
  input: {
    userId: number;
    username?: string;
    password?: string;
    groupUnknownSeries?: boolean;
    includeNonComicBooks?: boolean;
  },
): Promise<{ row: typeof schema.komgaUsers.$inferSelect; password: string }> {
  const username = input.username ?? `komga-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const password = input.password ?? 'KomgaCredential123';
  const passwordHash = await hash(password, 12);

  const [row] = await ctx.db
    .insert(schema.komgaUsers)
    .values({
      userId: input.userId,
      username,
      passwordHash,
      groupUnknownSeries: input.groupUnknownSeries ?? true,
      includeNonComicBooks: input.includeNonComicBooks ?? false,
    })
    .returning();

  return { row, password };
}
