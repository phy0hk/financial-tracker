/**
 * BackupEngine — export and import of ZeroTracker data.
 *
 * Supports three export formats:
 *  - **JSON** (decrypted or encrypted)
 *  - **CSV** (flat, per-table)
 *  - **`.ztbak`** (encrypted bundle)
 *
 * Import accepts any of the above, validates the schema, decrypts `.ztbak`
 * bundles when a key is supplied, and returns a {@link StructuredImport} the
 * storage layer can apply according to a {@link ConflictStrategy}.
 *
 * The engine is a pure data transformer: it does not read from or write to any
 * store. The caller supplies the data to export and consumes the structured
 * import it returns.
 */

import {
  encryptPayload,
  decryptPayload,
  generateSalt,
} from '../crypto/index';
import type {
  BackupJSON,
  BackupValidation,
  CSVExport,
  ConflictStrategy,
  EncryptedBackupPayload,
  ImportRecord,
  ImportResult,
  StructuredImport,
  TableImportDetail,
  ZTBakBundle,
} from './types';
import { ConflictStrategy as Strategy } from './types';

/** Current backup format version. */
const BACKUP_VERSION = 1;

/** Magic string identifying a `.ztbak` bundle. */
const ZTBK_MAGIC = 'ZTBK';

/**
 * Options for {@link BackupEngine.importFromBackup}.
 */
export interface ImportOptions {
  /** Conflict strategy. Defaults to {@link ConflictStrategy.SKIP}. */
  strategy?: ConflictStrategy;
  /**
   * The user id the import targets. When omitted, it is read from the backup
   * document (decrypted mode) or the decrypted payload (encrypted mode).
   */
  userId?: string;
}

/**
 * Transforms application data into portable backup formats and back.
 */
export class BackupEngine {
  /**
   * Export data to a JSON string.
   *
   * @param data - The user's data, keyed by table/collection.
   * @param mode - `'decrypted'` produces a plain JSON envelope; `'encrypted'`
   *   encrypts the payload with the supplied key.
   * @param key - Required when `mode` is `'encrypted'`. An AES-GCM-256
   *   `CryptoKey` (see {@link import { deriveMasterKey }}).
   * @returns A JSON string representing the {@link BackupJSON} envelope.
   * @throws {Error} If `mode` is `'encrypted'` but no key is provided.
   */
  async exportToJSON(
    data: Record<string, unknown>,
    mode: 'decrypted' | 'encrypted',
    key?: CryptoKey,
  ): Promise<string> {
    const createdAt = new Date().toISOString();

    if (mode === 'decrypted') {
      const envelope: BackupJSON = {
        version: BACKUP_VERSION,
        createdAt,
        mode: 'decrypted',
        data,
      };
      return JSON.stringify(envelope, null, 2);
    }

    if (!key) {
      throw new Error('A CryptoKey is required for encrypted export.');
    }

    const salt = generateSalt();
    // Re-derive a key bound to this salt so the salt is self-contained in the
    // bundle. The caller's `key` is used to encrypt the plaintext; the salt is
    // stored so a password-based flow can re-derive on import.
    const plaintext = JSON.stringify({ data });
    const payload = await encryptPayload(plaintext, key);

    const envelope: BackupJSON = {
      version: BACKUP_VERSION,
      createdAt,
      mode: 'encrypted',
      payload: {
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        authTag: payload.authTag,
        salt,
        iterations: 100_000,
      },
    };
    return JSON.stringify(envelope, null, 2);
  }

  /**
   * Export a single table of records to a CSV string.
   *
   * Records are normalized: each record's `id` (or first field) becomes the
   * primary key column, and remaining fields become columns. Values are
   * stringified; `null`/`undefined` become empty strings.
   *
   * @param table - The logical table name.
   * @param records - The records to export.
   * @returns A CSV string with a header row and one row per record.
   */
  exportToCSV(table: string, records: Record<string, unknown>[]): string {
    if (records.length === 0) {
      return '';
    }

    // Collect the union of keys, preserving first-seen order, with `id` first.
    const headers: string[] = [];
    const seen = new Set<string>();
    for (const record of records) {
      for (const key of Object.keys(record)) {
        if (!seen.has(key)) {
          seen.add(key);
          headers.push(key);
        }
      }
    }
    // Ensure `id` is the leading column if present.
    const idIndex = headers.indexOf('id');
    if (idIndex > 0) {
      headers.splice(idIndex, 1);
      headers.unshift('id');
    }

    const lines: string[] = [headers.map(escapeCSV).join(',')];
    for (const record of records) {
      const row = headers.map((h) => {
        const value = record[h];
        if (value === null || value === undefined) return '';
        if (value instanceof Date) return value.toISOString();
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
      });
      lines.push(row.map(escapeCSV).join(','));
    }
    return lines.join('\n');
  }

  /**
   * Export data to a CSV {@link CSVExport} structure (headers + rows).
   *
   * @param table - The logical table name.
   * @param records - The records to export.
   * @returns A {@link CSVExport} with ordered headers and aligned rows.
   */
  exportToCSVStructure(
    table: string,
    records: Record<string, unknown>[],
  ): CSVExport {
    if (records.length === 0) {
      return { table, headers: [], rows: [] };
    }

    const headers: string[] = [];
    const seen = new Set<string>();
    for (const record of records) {
      for (const key of Object.keys(record)) {
        if (!seen.has(key)) {
          seen.add(key);
          headers.push(key);
        }
      }
    }
    const idIndex = headers.indexOf('id');
    if (idIndex > 0) {
      headers.splice(idIndex, 1);
      headers.unshift('id');
    }

    const rows: string[][] = records.map((record) =>
      headers.map((h) => {
        const value = record[h];
        if (value === null || value === undefined) return '';
        if (value instanceof Date) return value.toISOString();
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
      }),
    );

    return { table, headers, rows };
  }

  /**
   * Export data to an encrypted `.ztbak` bundle string.
   *
   * @param data - The user's data, keyed by table/collection.
   * @param key - The AES-GCM-256 `CryptoKey` to encrypt with.
   * @returns A JSON string representing the {@link ZTBakBundle}.
   */
  async exportToZTBak(
    data: Record<string, unknown>,
    key: CryptoKey,
  ): Promise<string> {
    const salt = generateSalt();
    const plaintext = JSON.stringify({ data });
    const payload = await encryptPayload(plaintext, key);

    const bundle: ZTBakBundle = {
      magic: ZTBK_MAGIC,
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      payload: {
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        authTag: payload.authTag,
        salt,
        iterations: 100_000,
      },
    };
    return JSON.stringify(bundle, null, 2);
  }

  /**
   * Import from a backup document.
   *
   * Accepts a JSON string in any of the supported formats:
   *  - Decrypted {@link BackupJSON}
   *  - Encrypted {@link BackupJSON} (requires `key`)
   *  - `.ztbak` {@link ZTBakBundle} (requires `key`)
   *
   * The method validates the schema, decrypts when necessary, and returns a
   * {@link StructuredImport} grouped by table. It does not apply records to a
   * store — the caller does that using the returned `strategy`.
   *
   * @param backupContent - The raw backup string (JSON).
   * @param strategy - Conflict strategy to attach to the result.
   * @param key - Required for encrypted backups / `.ztbak` bundles.
   * @param options - Optional import options (e.g. explicit `userId`).
   * @returns A {@link StructuredImport} ready for the storage layer.
   * @throws {Error} If the document is invalid, undecryptable, or a key is
   *   missing for an encrypted backup.
   */
  async importFromBackup(
    backupContent: string,
    strategy: ConflictStrategy = Strategy.SKIP,
    key?: CryptoKey,
    options?: ImportOptions,
  ): Promise<StructuredImport> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(backupContent);
    } catch {
      throw new Error('Backup content is not valid JSON.');
    }

    // Detect format by shape.
    const doc = parsed as Record<string, unknown>;

    if (doc && doc.magic === ZTBK_MAGIC) {
      // .ztbak bundle.
      const bundle = doc as unknown as ZTBakBundle;
      const validation = this.validateZTBakBundle(bundle);
      if (!validation.valid) {
        throw new Error(
          `Invalid .ztbak bundle: ${validation.errors.join(', ')}`,
        );
      }
      if (!key) {
        throw new Error('A CryptoKey is required to decrypt a .ztbak bundle.');
      }
      const plaintext = await this.decryptPayload(bundle.payload, key);
      const { data, userId } = this.parseDecryptedPayload(plaintext);
      return this.buildStructuredImport(
        data,
        strategy,
        options?.userId ?? userId,
      );
    }

    // BackupJSON (decrypted or encrypted).
    const json = doc as unknown as BackupJSON;
    const validation = this.validateBackupJSON(json);
    if (!validation.valid) {
      throw new Error(
        `Invalid backup JSON: ${validation.errors.join(', ')}`,
      );
    }

    if (json.mode === 'decrypted') {
      if (!json.data) {
        throw new Error('Decrypted backup is missing its data field.');
      }
      return this.buildStructuredImport(
        json.data,
        strategy,
        options?.userId ?? json.userId,
      );
    }

    // Encrypted BackupJSON.
    if (!json.payload) {
      throw new Error('Encrypted backup is missing its payload field.');
    }
    if (!key) {
      throw new Error('A CryptoKey is required to decrypt an encrypted backup.');
    }
    const plaintext = await this.decryptPayload(json.payload, key);
    const { data, userId } = this.parseDecryptedPayload(plaintext);
    return this.buildStructuredImport(
      data,
      strategy,
      options?.userId ?? userId,
    );
  }

  /**
   * Validate a `.ztbak` bundle structure.
   *
   * @param bundle - The candidate bundle.
   * @returns A {@link BackupValidation} result.
   */
  validateZTBakBundle(bundle: ZTBakBundle): BackupValidation {
    const errors: string[] = [];
    if (!bundle || typeof bundle !== 'object') {
      return { valid: false, errors: ['bundle is not an object'] };
    }
    if (bundle.magic !== ZTBK_MAGIC) {
      errors.push('missing or invalid magic string');
    }
    if (typeof bundle.version !== 'number') {
      errors.push('missing or invalid version');
    }
    if (typeof bundle.createdAt !== 'string') {
      errors.push('missing or invalid createdAt');
    }
    const p = bundle.payload;
    if (!p || typeof p !== 'object') {
      errors.push('missing payload');
    } else {
      for (const field of ['ciphertext', 'iv', 'authTag', 'salt'] as const) {
        if (typeof p[field] !== 'string' || p[field].length === 0) {
          errors.push(`payload.${field} is missing or empty`);
        }
      }
      if (typeof p.iterations !== 'number') {
        errors.push('payload.iterations is missing or not a number');
      }
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate a `BackupJSON` envelope structure.
   *
   * @param json - The candidate envelope.
   * @returns A {@link BackupValidation} result.
   */
  validateBackupJSON(json: BackupJSON): BackupValidation {
    const errors: string[] = [];
    if (!json || typeof json !== 'object') {
      return { valid: false, errors: ['envelope is not an object'] };
    }
    if (typeof json.version !== 'number') {
      errors.push('missing or invalid version');
    }
    if (typeof json.createdAt !== 'string') {
      errors.push('missing or invalid createdAt');
    }
    if (json.mode !== 'decrypted' && json.mode !== 'encrypted') {
      errors.push(`invalid mode: ${String(json.mode)}`);
    }
    if (json.mode === 'decrypted' && json.data === undefined) {
      errors.push('decrypted backup missing data');
    }
    if (json.mode === 'encrypted' && json.payload === undefined) {
      errors.push('encrypted backup missing payload');
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * Compute an {@link ImportResult} summary from a structured import and the
   * existing records in the target.
   *
   * This is a pure helper: it does not mutate anything. The storage layer calls
   * it after applying records to produce a user-facing report.
   *
   * @param structured - The structured import to summarize.
   * @param existing - The records already present in the target, keyed by table.
   * @returns An {@link ImportResult} with per-table counts.
   */
  summarizeImport(
    structured: StructuredImport,
    existing: Record<string, ImportRecord[]>,
  ): ImportResult {
    const tables: Record<string, TableImportDetail> = {};
    let imported = 0;
    let skipped = 0;
    let overwritten = 0;
    let merged = 0;

    for (const [table, records] of Object.entries(structured.records)) {
      const existingIds = new Set(
        (existing[table] ?? []).map((r) => r.id),
      );
      const detail: TableImportDetail = {
        imported: 0,
        skipped: 0,
        overwritten: 0,
        merged: 0,
      };

      for (const record of records) {
        const exists = existingIds.has(record.id);
        switch (structured.strategy) {
          case Strategy.SKIP:
            if (exists) {
              detail.skipped++;
              skipped++;
            } else {
              detail.imported++;
              imported++;
            }
            break;
          case Strategy.OVERWRITE:
            if (exists) {
              detail.overwritten++;
              overwritten++;
            } else {
              detail.imported++;
              imported++;
            }
            break;
          case Strategy.MERGE:
            if (exists) {
              detail.merged++;
              merged++;
            } else {
              detail.imported++;
              imported++;
            }
            break;
        }
      }

      tables[table] = detail;
    }

    return {
      success: true,
      imported,
      skipped,
      overwritten,
      merged,
      tables,
    };
  }

  /**
   * Decrypt an {@link EncryptedBackupPayload} and return the plaintext JSON.
   */
  private async decryptPayload(
    payload: EncryptedBackupPayload,
    key: CryptoKey,
  ): Promise<string> {
    return decryptPayload(payload.ciphertext, payload.iv, payload.authTag, key);
  }

  /**
   * Parse a decrypted payload string into `{ data, userId }`.
   *
   * The payload is expected to be a JSON object with a `data` field (and
   * optionally a `userId`). Falls back to an empty object when the shape is
   * unexpected.
   */
  private parseDecryptedPayload(
    plaintext: string,
  ): { data: Record<string, unknown>; userId?: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(plaintext);
    } catch {
      throw new Error('Decrypted payload is not valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Decrypted payload is not a JSON object.');
    }
    const obj = parsed as Record<string, unknown>;
    const data =
      obj.data && typeof obj.data === 'object'
        ? (obj.data as Record<string, unknown>)
        : {};
    const userId =
      typeof obj.userId === 'string' ? obj.userId : undefined;
    return { data, userId };
  }

  /**
   * Build a {@link StructuredImport} from raw table-keyed data.
   *
   * Each table's value is expected to be an array of records. Records without
   * an explicit `id` are assigned one from their first field or a generated
   * index-based id.
   */
  private buildStructuredImport(
    data: Record<string, unknown>,
    strategy: ConflictStrategy,
    userId?: string,
  ): StructuredImport {
    const records: Record<string, ImportRecord[]> = {};

    for (const [table, value] of Object.entries(data)) {
      if (!Array.isArray(value)) continue;
      const tableRecords: ImportRecord[] = [];
      value.forEach((raw, index) => {
        if (!raw || typeof raw !== 'object') return;
        const record = raw as Record<string, unknown>;
        const id =
          typeof record.id === 'string'
            ? record.id
            : typeof record.id === 'number'
              ? String(record.id)
              : `${table}:${index}`;
        tableRecords.push({ id, data: record });
      });
      if (tableRecords.length > 0) {
        records[table] = tableRecords;
      }
    }

    return {
      userId: userId ?? 'unknown',
      strategy,
      records,
    };
  }
}

/**
 * Escape a value for CSV output.
 *
 * Wraps the value in double quotes when it contains a comma, double quote, or
 * newline, and doubles any embedded double quotes.
 */
function escapeCSV(value: string): string {
  if (
    value.includes(',') ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
