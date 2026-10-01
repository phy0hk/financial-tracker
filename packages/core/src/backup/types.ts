/**
 * Backup data schemas and conflict strategy definitions.
 *
 * These types define the wire formats for ZeroTracker backups:
 *  - **JSON** — human-readable, optionally encrypted.
 *  - **CSV** — flat tabular export for spreadsheet interoperability.
 *  - **`.ztbak`** — encrypted bundle (JSON envelope + AES-GCM payload).
 *
 * The {@link ConflictStrategy} enum governs how `importFromBackup` resolves
 * rows that already exist in the target store.
 */

/**
 * How to resolve rows that already exist in the target during import.
 */
export enum ConflictStrategy {
  /** Skip rows whose primary key already exists in the target. */
  SKIP = 'SKIP',
  /** Overwrite existing rows with the incoming data. */
  OVERWRITE = 'OVERWRITE',
  /**
   * Merge field-by-field: for each existing row, update only the fields
   * present in the incoming record. Fields absent from the incoming record
   * retain their existing values.
   */
  MERGE = 'MERGE',
}

/**
 * Top-level JSON export envelope.
 *
 * When `mode` is `'encrypted'`, the `payload` field is an
 * {@link EncryptedBackupPayload} and `data` is absent. When `mode` is
 * `'decrypted'`, `data` holds the plain export and `payload` is absent.
 */
export interface BackupJSON {
  /** Format version for forward-compatibility. */
  version: number;
  /** ISO-8601 timestamp of when the backup was created. */
  createdAt: string;
  /** Whether the backup content is encrypted. */
  mode: 'decrypted' | 'encrypted';
  /**
   * The user id whose data this backup contains.
   * Present in decrypted mode; in encrypted mode it is embedded in the payload.
   */
  userId?: string;
  /** Plain export data (decrypted mode only). */
  data?: Record<string, unknown>;
  /** Encrypted payload (encrypted mode only). */
  payload?: EncryptedBackupPayload;
}

/**
 * The encrypted portion of a `.ztbak` / encrypted JSON backup.
 *
 * Mirrors the crypto module's {@link import type { EncryptedPayload }} shape
 * but adds a `salt` so the key can be re-derived on import without external
 * state.
 */
export interface EncryptedBackupPayload {
  /** Base64-encoded ciphertext. */
  ciphertext: string;
  /** Base64-encoded 12-byte IV. */
  iv: string;
  /** Base64-encoded 16-byte authentication tag. */
  authTag: string;
  /** Base64-encoded PBKDF2 salt used to derive the encryption key. */
  salt: string;
  /** PBKDF2 iteration count used during derivation. */
  iterations: number;
}

/**
 * A single CSV export: one table/record set.
 */
export interface CSVExport {
  /** Logical table/collection name (e.g. "transactions"). */
  table: string;
  /** Column headers in order. */
  headers: string[];
  /** Rows as arrays of string values, aligned to `headers`. */
  rows: string[][];
}

/**
 * The full `.ztbak` bundle structure.
 *
 * A `.ztbak` file is a JSON document with this shape. The `payload` field
 * contains the AES-GCM-encrypted JSON export (see {@link BackupJSON}).
 */
export interface ZTBakBundle {
  /** Magic string for format detection. */
  magic: 'ZTBK';
  /** Format version. */
  version: number;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** The encrypted payload. */
  payload: EncryptedBackupPayload;
}

/**
 * Result of a backup import operation.
 */
export interface ImportResult {
  /** Whether the import completed without fatal errors. */
  success: boolean;
  /** Number of rows/records successfully imported. */
  imported: number;
  /** Number of rows skipped due to conflicts (SKIP strategy). */
  skipped: number;
  /** Number of rows overwritten (OVERWRITE strategy). */
  overwritten: number;
  /** Number of rows merged (MERGE strategy). */
  merged: number;
  /** Per-table import details. */
  tables: Record<string, TableImportDetail>;
  /** Error message if the import failed fatally. */
  error?: string;
}

/**
 * Per-table import statistics.
 */
export interface TableImportDetail {
  imported: number;
  skipped: number;
  overwritten: number;
  merged: number;
}

/**
 * A structured import record prepared by {@link BackupEngine.importFromBackup}.
 *
 * The consumer (storage layer) receives these and applies them according to
 * the chosen {@link ConflictStrategy}.
 */
export interface StructuredImport {
  /** The user id this import targets. */
  userId: string;
  /** Conflict strategy to apply. */
  strategy: ConflictStrategy;
  /** Records grouped by table/collection name. */
  records: Record<string, ImportRecord[]>;
}

/**
 * A single record within a structured import.
 */
export interface ImportRecord {
  /** Primary key / unique identifier for the record. */
  id: string;
  /** The record's field values. */
  data: Record<string, unknown>;
}

/**
 * Validation result for a backup document.
 */
export interface BackupValidation {
  valid: boolean;
  errors: string[];
}
