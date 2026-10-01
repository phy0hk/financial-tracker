import type { IAppModule, ModuleMigrations } from '../types';

export type DuressTransaction = { id: string; merchant: string; amount: number; date: string; kind: 'debit' | 'credit' };

export interface EphemeralSQLiteDatabase {
  readonly name: string;
  readonly transactions: readonly DuressTransaction[];
  exec(sql: string, params?: readonly unknown[]): Promise<void>;
  close(): Promise<void>;
}

class MemorySQLiteDatabase implements EphemeralSQLiteDatabase {
  readonly name = ':memory:duress:';
  private closed = false;
  constructor(public readonly transactions: readonly DuressTransaction[]) {}
  async exec(_sql: string, _params: readonly unknown[] = []): Promise<void> {
    if (this.closed) throw new Error('The duress database is closed.');
  }
  async close(): Promise<void> { this.closed = true; }
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function digestPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

export class EmergencyDuressModule implements IAppModule {
  readonly id = 'emergency-duress';
  readonly name = 'Emergency duress mode';
  readonly description = 'Opens a separate, disposable transaction view when a secondary PIN is entered.';
  readonly isEnabledByDefault = false;
  private readonly salt: string;
  private pinDigest: string | null = null;
  private ephemeralDatabase: EphemeralSQLiteDatabase | null = null;

  constructor(options: { duressPin?: string; salt?: string } = {}) {
    this.salt = options.salt ?? 'zerotracker-duress-v1';
    if (options.duressPin) void this.setDuressPin(options.duressPin);
  }

  getMigrations(): ModuleMigrations {
    return { sqlite: [], postgres: [] };
  }

  async setDuressPin(pin: string): Promise<void> {
    if (!/^\d{4,12}$/.test(pin)) throw new Error('The duress PIN must contain 4 to 12 digits.');
    this.pinDigest = await digestPin(pin, this.salt);
  }

  async verifyDuressPin(pin: string): Promise<boolean> {
    if (!this.pinDigest || !/^\d{4,12}$/.test(pin)) return false;
    return (await digestPin(pin, this.salt)) === this.pinDigest;
  }

  async activate(pin: string): Promise<EphemeralSQLiteDatabase> {
    if (!(await this.verifyDuressPin(pin))) throw new Error('Invalid duress PIN.');
    await this.deactivate();
    const now = new Date();
    const transactions: DuressTransaction[] = [
      { id: 'duress-1', merchant: 'Grocery Market', amount: 42.18, date: now.toISOString().slice(0, 10), kind: 'debit' },
      { id: 'duress-2', merchant: 'Coffee Shop', amount: 6.5, date: new Date(now.getTime() - 86400000).toISOString().slice(0, 10), kind: 'debit' },
      { id: 'duress-3', merchant: 'Payroll', amount: 1200, date: new Date(now.getTime() - 172800000).toISOString().slice(0, 10), kind: 'credit' },
    ];
    this.ephemeralDatabase = new MemorySQLiteDatabase(transactions);
    await this.ephemeralDatabase.exec('CREATE TABLE transactions (id TEXT PRIMARY KEY, merchant TEXT, amount REAL, date TEXT, kind TEXT);');
    return this.ephemeralDatabase;
  }

  async deactivate(): Promise<void> {
    if (this.ephemeralDatabase) await this.ephemeralDatabase.close();
    this.ephemeralDatabase = null;
  }

  get activeDatabase(): EphemeralSQLiteDatabase | null { return this.ephemeralDatabase; }
  async exportModuleData(_userId: string): Promise<Record<string, unknown>> { return { exported: false }; }
  async importModuleData(_userId: string, _data: Record<string, unknown>): Promise<void> { return undefined; }
}

export default EmergencyDuressModule;
