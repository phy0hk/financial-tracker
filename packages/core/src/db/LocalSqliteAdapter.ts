/**
 * LocalSqliteAdapter — on-device storage for ZeroTracker.
 *
 * Implements {@link IDatabaseAdapter} against a generic SQLite connection so it
 * runs on both `expo-sqlite` (React Native / Expo) and `@sqlite.org/sqlite-wasm`
 * (WebAssembly SQLite in browsers). The driver is abstracted behind
 * {@link SQLiteConnection}; see {@link createExpoSQLiteConnection} and
 * {@link createSqliteWasmConnection} for the adapters.
 *
 * The adapter owns the local SQLite schema (created via `init()`), all CRUD for
 * users/categories/expenses, and the outbound `sync_queue` that backs
 * {@link IDatabaseAdapter.getPendingSyncDeltas} and
 * {@link IDatabaseAdapter.markSynced}.
 */

import { ALL_SQLITE_DDL } from './sqlite-schema';
import {
  generateId,
  type EncryptedCategory,
  type EncryptedExpense,
  type EncryptedUser,
  type IDatabaseAdapter,
  type SyncDeltas,
  type SyncOperation,
} from './types';

/** Values that can be bound as SQLite parameters. */
export type SQLiteParams = Array<string | number | null>;

/** Result of a statement that changes rows. */
export interface SQLiteRunResult {
  /** The rowid of the last inserted row (0 when none). */
  lastInsertRowId: number;
  /** Number of rows affected. */
  changes: number;
}

/**
 * Minimal, driver-agnostic SQLite connection.
 *
 * Both `expo-sqlite` (async API) and `@sqlite.org/sqlite-wasm` can be adapted to
 * this shape. `run`/`all`/`get` are for single statements with parameters;
 * `exec` runs a script that may contain multiple statements (used for DDL).
 */
export interface SQLiteConnection {
  /** Execute a single statement that returns no rows (INSERT/UPDATE/DELETE). */
  run(sql: string, params?: SQLiteParams): Promise<SQLiteRunResult>;
  /** Execute a script that may contain multiple statements (DDL). */
  exec(sql: string): Promise<void>;
  /** Execute a query and return all matching rows. */
  all<T = Record<string, unknown>>(
    sql: string,
    params?: SQLiteParams,
  ): Promise<T[]>;
  /** Execute a query and return the first matching row, or `null`. */
  get<T = Record<string, unknown>>(
    sql: string,
    params?: SQLiteParams,
  ): Promise<T | null>;
}

/**
 * Adapt an `expo-sqlite` `SQLiteDatabase` to {@link SQLiteConnection}.
 *
 * Expects the modern async API (`runAsync`, `execAsync`, `getAllAsync`,
 * `getFirstAsync`). The parameter is typed structurally so this file does not
 * need `expo-sqlite` installed.
 */
export function createExpoSQLiteConnection(
  db: {
    runAsync: (
      sql: string,
      params?: (string | number | null)[],
    ) => Promise<{ lastInsertRowId: number; rowsAffected: number }>;
    execAsync: (sql: string) => Promise<void>;
    getAllAsync: <T = Record<string, unknown>>(
      sql: string,
      params?: (string | number | null)[],
    ) => Promise<T[]>;
    getFirstAsync: <T = Record<string, unknown>>(
      sql: string,
      params?: (string | number | null)[],
    ) => Promise<T | undefined>;
  },
): SQLiteConnection {
  return {
    async run(sql, params) {
      const result = await db.runAsync(sql, params ?? []);
      return {
        lastInsertRowId: result.lastInsertRowId,
        changes: result.rowsAffected,
      };
    },
    async exec(sql) {
      await db.execAsync(sql);
    },
    async all<T>(sql: string, params?: SQLiteParams) {
      return db.getAllAsync<T>(sql, params ?? []);
    },
    async get<T>(sql: string, params?: SQLiteParams) {
      return (await db.getFirstAsync<T>(sql, params ?? [])) ?? null;
    },
  };
}

/**
 * Adapt an `@sqlite.org/sqlite-wasm` `SQLite` instance to
 * {@link SQLiteConnection}.
 *
 * The parameter is typed structurally so this file does not need the
 * `@sqlite.org/sqlite-wasm` package installed.
 */
export function createSqliteWasmConnection(
  db: {
    prepare: (sql: string) => {
      run: (...params: (string | number | null)[]) => unknown;
      all: (...params: (string | number | null)[]) => Record<string, unknown>[];
      get: (...params: (string | number | null)[]) => Record<string, unknown> | undefined;
      close: () => void;
    };
    exec: (sql: string) => void;
    lastInsertRowid?: number;
    changes?: number;
  },
): SQLiteConnection {
  return {
    async run(sql, params) {
      const stmt = db.prepare(sql);
      try {
        if (params && params.length > 0) stmt.run(...params);
        else stmt.run();
        return {
          lastInsertRowId: Number(db.lastInsertRowid ?? 0),
          changes: Number(db.changes ?? 0),
        };
      } finally {
        stmt.close();
      }
    },
    async exec(sql) {
      db.exec(sql);
    },
    async all<T>(sql: string, params?: SQLiteParams) {
      const stmt = db.prepare(sql);
      try {
        const rows =
          params && params.length > 0 ? stmt.all(...params) : stmt.all();
        return rows as T[];
      } finally {
        stmt.close();
      }
    },
    async get<T>(sql: string, params?: SQLiteParams) {
      const stmt = db.prepare(sql);
      try {
        const row =
          params && params.length > 0 ? stmt.get(...params) : stmt.get();
        return (row as T | undefined) ?? null;
      } finally {
        stmt.close();
      }
    },
  };
}

/** Map a `local_expenses` row to an {@link EncryptedExpense}. */
function mapRowToExpense(row: Record<string, unknown>): EncryptedExpense {
  return {
    id: row.id as string,
    userId: row.userId as string,
    categoryId: (row.categoryId as string | null) ?? null,
    encryptedAmount: row.encryptedAmount as string,
    encryptedDescription: (row.encryptedDescription as string | null) ?? null,
    iv: row.iv as string,
    authTag: row.authTag as string,
    date: row.date as string,
    createdAt: row.createdAt as string,
  };
}

/** Map a `local_categories` row to an {@link EncryptedCategory}. */
function mapRowToCategory(row: Record<string, unknown>): EncryptedCategory {
  return {
    id: row.id as string,
    userId: row.userId as string,
    encryptedName: row.encryptedName as string,
    encryptedIcon: (row.encryptedIcon as string | null) ?? null,
    encryptedColor: (row.encryptedColor as string | null) ?? null,
    createdAt: row.createdAt as string,
  };
}

/** Parse a JSON payload string, falling back to `{}` when empty/invalid. */
function parsePayload(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * On-device {@link IDatabaseAdapter} backed by SQLite.
 */
export class LocalSqliteAdapter implements IDatabaseAdapter {
  private readonly db: SQLiteConnection;

  /**
   * @param db - A {@link SQLiteConnection} (see the factory helpers).
   */
  constructor(db: SQLiteConnection) {
    this.db = db;
  }

  /**
   * Create the local schema (idempotent). Call once before using the adapter.
   */
  async init(): Promise<void> {
    await this.db.exec(ALL_SQLITE_DDL.join(''));
  }

  // ------------------------------------------------------------------ users
  /**
   * Upsert a local user record (offline auth cache).
   */
  async saveUser(user: EncryptedUser): Promise<void> {
    await this.db.run(
      `INSERT INTO local_users
         (id, email, passwordHash, role, salt, isActive, encryptedProfile, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         passwordHash = excluded.passwordHash,
         role = excluded.role,
         salt = excluded.salt,
         isActive = excluded.isActive,
         encryptedProfile = excluded.encryptedProfile,
         createdAt = excluded.createdAt`,
      [
        user.id,
        user.email,
        user.passwordHash,
        user.role,
        user.salt,
        user.isActive ? 1 : 0,
        null,
        user.createdAt,
      ],
    );
  }

  async getUser(id: string): Promise<EncryptedUser | null> {
    const row = await this.db.get<Record<string, unknown>>(
      `SELECT * FROM local_users WHERE id = ?`,
      [id],
    );
    if (!row) return null;
    return {
      id: row.id as string,
      email: row.email as string,
      passwordHash: row.passwordHash as string,
      role: row.role as string,
      salt: row.salt as string,
      isActive: row.isActive === 1 || row.isActive === true,
      createdAt: row.createdAt as string,
    };
  }

  // ---------------------------------------------------------------- expenses
  async getExpenses(userId: string): Promise<EncryptedExpense[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT * FROM local_expenses WHERE userId = ? ORDER BY date DESC`,
      [userId],
    );
    return rows.map(mapRowToExpense);
  }

  async getExpenseById(id: string): Promise<EncryptedExpense | null> {
    const row = await this.db.get<Record<string, unknown>>(
      `SELECT * FROM local_expenses WHERE id = ?`,
      [id],
    );
    return row ? mapRowToExpense(row) : null;
  }

  async addExpense(expense: Omit<EncryptedExpense, 'id'>): Promise<EncryptedExpense> {
    const record: EncryptedExpense = { id: generateId(), ...expense };
    await this.db.run(
      `INSERT INTO local_expenses
         (id, userId, categoryId, encryptedAmount, encryptedDescription, iv, authTag, date, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.userId,
        record.categoryId ?? null,
        record.encryptedAmount,
        record.encryptedDescription ?? null,
        record.iv,
        record.authTag,
        record.date,
        record.createdAt,
      ],
    );
    await this.enqueueDelta(
      record.userId,
      'expense',
      record.id,
      'insert',
      record,
    );
    return record;
  }

  async updateExpense(expense: EncryptedExpense): Promise<EncryptedExpense> {
    await this.db.run(
      `UPDATE local_expenses SET
         userId = ?,
         categoryId = ?,
         encryptedAmount = ?,
         encryptedDescription = ?,
         iv = ?,
         authTag = ?,
         date = ?,
         createdAt = ?
       WHERE id = ?`,
      [
        expense.userId,
        expense.categoryId ?? null,
        expense.encryptedAmount,
        expense.encryptedDescription ?? null,
        expense.iv,
        expense.authTag,
        expense.date,
        expense.createdAt,
        expense.id,
      ],
    );
    await this.enqueueDelta(
      expense.userId,
      'expense',
      expense.id,
      'update',
      expense,
    );
    return expense;
  }

  async deleteExpense(id: string): Promise<void> {
    const row = await this.db.get<Record<string, unknown>>(
      `SELECT userId FROM local_expenses WHERE id = ?`,
      [id],
    );
    await this.db.run(`DELETE FROM local_expenses WHERE id = ?`, [id]);
    if (row) {
      await this.enqueueDelta(
        row.userId as string,
        'expense',
        id,
        'delete',
        { id },
      );
    }
  }

  // --------------------------------------------------------------- categories
  async getCategories(userId: string): Promise<EncryptedCategory[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT * FROM local_categories WHERE userId = ? ORDER BY createdAt ASC`,
      [userId],
    );
    return rows.map(mapRowToCategory);
  }

  async getCategoryById(id: string): Promise<EncryptedCategory | null> {
    const row = await this.db.get<Record<string, unknown>>(
      `SELECT * FROM local_categories WHERE id = ?`,
      [id],
    );
    return row ? mapRowToCategory(row) : null;
  }

  async addCategory(
    category: Omit<EncryptedCategory, 'id'>,
  ): Promise<EncryptedCategory> {
    const record: EncryptedCategory = { id: generateId(), ...category };
    await this.db.run(
      `INSERT INTO local_categories
         (id, userId, encryptedName, encryptedIcon, encryptedColor, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.userId,
        record.encryptedName,
        record.encryptedIcon ?? null,
        record.encryptedColor ?? null,
        record.createdAt,
      ],
    );
    await this.enqueueDelta(
      record.userId,
      'category',
      record.id,
      'insert',
      record,
    );
    return record;
  }

  async updateCategory(category: EncryptedCategory): Promise<EncryptedCategory> {
    await this.db.run(
      `UPDATE local_categories SET
         userId = ?,
         encryptedName = ?,
         encryptedIcon = ?,
         encryptedColor = ?,
         createdAt = ?
       WHERE id = ?`,
      [
        category.userId,
        category.encryptedName,
        category.encryptedIcon ?? null,
        category.encryptedColor ?? null,
        category.createdAt,
        category.id,
      ],
    );
    await this.enqueueDelta(
      category.userId,
      'category',
      category.id,
      'update',
      category,
    );
    return category;
  }

  async deleteCategory(id: string): Promise<void> {
    const row = await this.db.get<Record<string, unknown>>(
      `SELECT userId FROM local_categories WHERE id = ?`,
      [id],
    );
    await this.db.run(`DELETE FROM local_categories WHERE id = ?`, [id]);
    if (row) {
      await this.enqueueDelta(
        row.userId as string,
        'category',
        id,
        'delete',
        { id },
      );
    }
  }

  // --------------------------------------------------------------------- sync
  async getPendingSyncDeltas(
    userId: string,
  ): Promise<Record<string, unknown>> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT entityType, recordId, operation, payload
       FROM sync_queue
       WHERE userId = ? AND syncStatus = 'pending'
       ORDER BY createdAt ASC`,
      [userId],
    );

    const deltas: SyncDeltas = { expenses: [], categories: [] };
    for (const row of rows) {
      const delta = {
        entityType: row.entityType as 'expense' | 'category',
        recordId: row.recordId as string,
        operation: row.operation as SyncOperation,
        payload: parsePayload(row.payload as string | null),
      };
      if (delta.entityType === 'expense') deltas.expenses.push(delta);
      else deltas.categories.push(delta);
    }
    return deltas as unknown as Record<string, unknown>;
  }

  async markSynced(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const placeholders = ids.map(() => '?').join(', ');
    await this.db.run(
      `UPDATE sync_queue
       SET syncStatus = 'synced', updatedAt = ?
       WHERE recordId IN (${placeholders}) AND syncStatus = 'pending'`,
      [now, ...ids],
    );
  }

  // ----------------------------------------------------------------- private
  /**
   * Upsert a sync delta. The queue row id is deterministic
   * (`entityType:recordId`) so re-queueing the same record updates the existing
   * row instead of duplicating it.
   */
  private async enqueueDelta(
    userId: string,
    entityType: 'expense' | 'category',
    recordId: string,
    operation: SyncOperation,
    payload: unknown,
  ): Promise<void> {
    const now = new Date().toISOString();
    const queueId = `${entityType}:${recordId}`;
    await this.db.run(
      `INSERT INTO sync_queue
         (id, userId, entityType, recordId, operation, payload, syncStatus, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         operation = excluded.operation,
         payload = excluded.payload,
         syncStatus = 'pending',
         updatedAt = excluded.updatedAt`,
      [
        queueId,
        userId,
        entityType,
        recordId,
        operation,
        payload === null ? null : JSON.stringify(payload),
        now,
        now,
      ],
    );
  }
}
