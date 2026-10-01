/**
 * Local SQLite schema (raw SQL DDL).
 *
 * These statements define the on-device storage used by
 * {@link LocalSqliteAdapter}. All financial fields mirror the cloud PostgreSQL
 * schema (`apps/server/src/db/schema.ts`) so a record can move between the two
 * backends without transformation — only the engine differs.
 *
 * Timestamps are stored as ISO-8601 TEXT to match the TypeScript record shapes
 * (`string`). Booleans are stored as INTEGER (SQLite has no native bool type).
 *
 * The `sync_queue` table backs the {@link IDatabaseAdapter.getPendingSyncDeltas}
 * and {@link IDatabaseAdapter.markSynced} operations in `HYBRID_SYNC` mode.
 */

/**
 * Local user cache.
 *
 * Holds the auth material needed for offline operation. `encryptedProfile`
 * carries any E2EE user profile payload the app may store locally.
 */
export const LOCAL_USERS_SQL = `
CREATE TABLE IF NOT EXISTS local_users (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL,
  passwordHash       TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'user',
  salt               TEXT NOT NULL,
  isActive           INTEGER NOT NULL DEFAULT 1,
  encryptedProfile   TEXT,
  createdAt          TEXT NOT NULL
);
`;

/**
 * Local categories, encrypted client-side.
 */
export const LOCAL_CATEGORIES_SQL = `
CREATE TABLE IF NOT EXISTS local_categories (
  id                 TEXT PRIMARY KEY,
  userId             TEXT NOT NULL,
  encryptedName      TEXT NOT NULL,
  encryptedIcon      TEXT,
  encryptedColor     TEXT,
  createdAt          TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES local_users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_local_categories_user
  ON local_categories (userId);
`;

/**
 * Local expenses, encrypted client-side.
 */
export const LOCAL_EXPENSES_SQL = `
CREATE TABLE IF NOT EXISTS local_expenses (
  id                     TEXT PRIMARY KEY,
  userId                 TEXT NOT NULL,
  categoryId             TEXT,
  encryptedAmount        TEXT NOT NULL,
  encryptedDescription   TEXT,
  iv                     TEXT NOT NULL,
  authTag                TEXT NOT NULL,
  date                   TEXT NOT NULL,
  createdAt              TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES local_users (id) ON DELETE CASCADE,
  FOREIGN KEY (categoryId) REFERENCES local_categories (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_local_expenses_user
  ON local_expenses (userId);
CREATE INDEX IF NOT EXISTS idx_local_expenses_category
  ON local_expenses (categoryId);
CREATE INDEX IF NOT EXISTS idx_local_expenses_date
  ON local_expenses (date);
`;

/**
 * Per-user module enablement, mirroring the cloud `user_modules` table.
 *
 * Composite primary key `(userId, moduleId)`.
 */
export const LOCAL_USER_MODULES_SQL = `
CREATE TABLE IF NOT EXISTS local_user_modules (
  userId             TEXT NOT NULL,
  moduleId           TEXT NOT NULL,
  isEnabled          INTEGER NOT NULL DEFAULT 1,
  updatedAt          TEXT NOT NULL,
  PRIMARY KEY (userId, moduleId),
  FOREIGN KEY (userId) REFERENCES local_users (id) ON DELETE CASCADE
);
`;

/**
 * Outbound sync queue.
 *
 * Each row is one locally-made change awaiting push to the cloud. `recordId`
 * is stable per logical record so re-queueing upserts the same row.
 */
export const SYNC_QUEUE_SQL = `
CREATE TABLE IF NOT EXISTS sync_queue (
  id                 TEXT PRIMARY KEY,
  userId             TEXT NOT NULL,
  entityType         TEXT NOT NULL,
  recordId           TEXT NOT NULL,
  operation          TEXT NOT NULL,
  payload            TEXT,
  syncStatus         TEXT NOT NULL DEFAULT 'pending',
  createdAt          TEXT NOT NULL,
  updatedAt          TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES local_users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sync_queue_user_status
  ON sync_queue (userId, syncStatus);
CREATE INDEX IF NOT EXISTS idx_sync_queue_record
  ON sync_queue (entityType, recordId);
`;

/**
 * All DDL statements, in dependency order (users first, then children).
 *
 * Each string may contain multiple statements (CREATE TABLE + CREATE INDEX).
 * Pass the concatenated string to a driver's `exec` to apply the schema.
 */
export const ALL_SQLITE_DDL: readonly string[] = [
  LOCAL_USERS_SQL,
  LOCAL_CATEGORIES_SQL,
  LOCAL_EXPENSES_SQL,
  LOCAL_USER_MODULES_SQL,
  SYNC_QUEUE_SQL,
];
