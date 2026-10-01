/**
 * Storage Abstraction Layer — barrel export.
 *
 * Re-exports the storage contracts, the local SQLite schema + adapter, and the
 * cloud PostgreSQL adapter. Apps import from `@zerotracker/core/db`.
 */

export {
  StorageMode,
  generateId,
  type EncryptedUser,
  type EncryptedCategory,
  type EncryptedExpense,
  type IDatabaseAdapter,
  type SyncStatus,
  type SyncOperation,
  type SyncDelta,
  type SyncDeltas,
} from './types';

export {
  LOCAL_USERS_SQL,
  LOCAL_CATEGORIES_SQL,
  LOCAL_EXPENSES_SQL,
  LOCAL_USER_MODULES_SQL,
  SYNC_QUEUE_SQL,
  ALL_SQLITE_DDL,
} from './sqlite-schema';

export {
  LocalSqliteAdapter,
  createExpoSQLiteConnection,
  createSqliteWasmConnection,
  type SQLiteConnection,
  type SQLiteParams,
  type SQLiteRunResult,
} from './LocalSqliteAdapter';

export {
  CloudPostgresAdapter,
  CloudAPIError,
  type CloudAdapterOptions,
} from './CloudPostgresAdapter';
