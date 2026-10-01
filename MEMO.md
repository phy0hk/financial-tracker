# ZeroTracker Development Progress Memo

## Current Status

- Active Section: 3 / 6 (Storage Abstraction Layer & Schemas) — COMPLETED
- Next Section: 4 / 6 (Cloudflare Workers Backend API with Hono)

## Completed Work

- [x] Workspace setup (`package.json`, `tsconfig.json`) — COMPLETED
- [x] Core E2EE Crypto module (`/packages/core/src/crypto`) — COMPLETED
- [x] Plugin Architecture System (`/packages/core/src/plugins`) — COMPLETED
- [x] Data Backup Engine (`/packages/core/src/backup`) — COMPLETED
- [x] Storage Abstraction Layer and database schemas (`/packages/core/src/db`, `/apps/server/src/db`) — COMPLETED

## Exports / Contracts Available for Next Session

### Crypto (Section 1)

- `deriveMasterKey`, `encryptPayload`, `decryptPayload`, `generateSalt`
- `EncryptedPayload { ciphertext, iv, authTag }` (all base64)

### Plugins and Backup (Section 2)

- `IAppModule`, `ModuleMigrations`, `DashboardWidget`, `NavigationItem`, `SettingsTab`
- `PluginManager`, `PluginStateStore`, `MemoryPluginStateStore`, `LocalStoragePluginStateStore`
- `ConflictStrategy`, `BackupJSON`, `ZTBakBundle`, `StructuredImport`, `ImportResult`
- `BackupEngine` export/import, validation, and import summary APIs

### Storage (Section 3) — `packages/core/src/db`

- `StorageMode`: `LOCAL_ONLY`, `CLOUD_ONLY`, `HYBRID_SYNC`
- `EncryptedUser`, `EncryptedCategory`, `EncryptedExpense`
- `IDatabaseAdapter`: expense/category CRUD plus `getPendingSyncDeltas` and `markSynced`
- `SyncStatus`, `SyncOperation`, `SyncDelta`, `SyncDeltas`, `generateId`
- SQLite DDL: `LOCAL_USERS_SQL`, `LOCAL_CATEGORIES_SQL`, `LOCAL_EXPENSES_SQL`,
  `LOCAL_USER_MODULES_SQL`, `SYNC_QUEUE_SQL`, `ALL_SQLITE_DDL`
- `SQLiteConnection`, `createExpoSQLiteConnection`, `createSqliteWasmConnection`
- `LocalSqliteAdapter` with local CRUD and pending sync queue management
- `CloudPostgresAdapter`, `CloudAdapterOptions`, `CloudAPIError`
- Import from `@zerotracker/core/db`; package export added in `packages/core/package.json`

### Cloud PostgreSQL schema (Section 3) — `apps/server/src/db/schema.ts`

- Drizzle tables: `users`, `categories`, `expenses`, `userModules`
- `userRole` enum and inferred `User`, `Category`, `Expense`, `UserModule` types
- `drizzle-orm` dependency added to `apps/server/package.json`

## Known Dependencies & Notes

- Package Manager: Bun (v1.2.15+; tested on 1.3.13)
- Crypto Engine: Native WebCrypto API (AES-GCM-256 + PBKDF2, 100k iterations)
- Backup encryption reuses the Section 1 crypto module; `.ztbak` bundles wrap an
  encrypted `BackupJSON`-style payload with a `ZTBK` magic string.
- `LocalSqliteAdapter` uses a generic async `SQLiteConnection` interface compatible
  with Expo SQLite and SQLite WASM adapters.
- `CloudPostgresAdapter` expects the Section 4 API routes under `/v1` by default.
- Local writes enqueue deterministic `entityType:recordId` sync rows; repeated
  updates replace the pending delta rather than creating duplicates.

## Targets for Section 4 — Cloudflare Workers Backend API with Hono

- Scaffold the `apps/server` Hono/Cloudflare Workers application and environment
  bindings for PostgreSQL, JWT authentication, and runtime configuration.
- Implement auth endpoints for registration, login, token refresh, and account
  deactivation using the server-side `users` schema.
- Implement authenticated CRUD endpoints matching `CloudPostgresAdapter`:
  `/v1/users/:userId/expenses`, `/v1/expenses/:id`,
  `/v1/users/:userId/categories`, `/v1/categories/:id`, and sync routes.
- Validate request/response bodies, enforce user ownership, and preserve opaque
  encrypted financial fields without server-side decryption.
- Add CORS, structured error responses, rate limiting hooks, and database
  migration configuration for Drizzle.

## Open Issues

- Pre-existing typecheck error in Section 1 `packages/core/src/crypto/index.ts`
  (`decryptPayload`, line 163): `Uint8Array<ArrayBufferLike>` is not assignable to
  `BufferSource` under the installed TypeScript DOM lib. Section 3 files are
  type-clean; this error was not introduced by Section 3.
