import type { IAppModule, ModuleMigrations, DashboardWidget, NavigationItem } from '../types';

export type Subscription = { id: string; userId: string; name: string; amount: number; currency: string; billingDay: number; active: boolean; createdAt: string };

function renewalDate(billingDay: number, from = new Date()): string {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  const day = Math.min(Math.max(1, billingDay), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  let renewal = new Date(Date.UTC(year, month, day));
  if (renewal.getTime() < from.getTime()) {
    const nextMonth = month + 1;
    renewal = new Date(Date.UTC(year, nextMonth, Math.min(Math.max(1, billingDay), new Date(Date.UTC(year, nextMonth + 1, 0)).getUTCDate())));
  }
  return renewal.toISOString().slice(0, 10);
}

export class SubscriptionsModule implements IAppModule {
  readonly id = 'subscriptions';
  readonly name = 'Subscriptions';
  readonly description = 'Track recurring monthly bills and upcoming renewal dates.';
  readonly isEnabledByDefault = true;
  readonly navigationItems: NavigationItem[] = [{ id: 'subscriptions', label: 'Subscriptions', icon: 'repeat', route: '/dashboard', order: 30 }];
  readonly dashboardWidgets: DashboardWidget[] = [{ id: 'subscription-overhead', title: 'Monthly subscriptions', render: async (userId) => ({ monthlyOverhead: this.getMonthlyOverhead(userId), upcoming: this.getUpcomingRenewals(userId, 3) }) }];
  private readonly records = new Map<string, Subscription[]>();

  getMigrations(): ModuleMigrations {
    return {
      sqlite: [`CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', billingDay INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL);`, `CREATE INDEX IF NOT EXISTS idx_subscriptions_user_active ON subscriptions(userId, active);`],
      postgres: [`CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, name TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', "billingDay" INTEGER NOT NULL CHECK ("billingDay" BETWEEN 1 AND 31), active BOOLEAN NOT NULL DEFAULT TRUE, "createdAt" TIMESTAMPTZ NOT NULL);`, `CREATE INDEX IF NOT EXISTS idx_subscriptions_user_active ON subscriptions("userId", active);`],
    };
  }

  addSubscription(input: Omit<Subscription, 'id' | 'createdAt'>): Subscription {
    if (!Number.isFinite(input.amount) || input.amount < 0) throw new Error('Subscription amount must be a non-negative number.');
    if (!Number.isInteger(input.billingDay) || input.billingDay < 1 || input.billingDay > 31) throw new Error('Billing day must be between 1 and 31.');
    const record: Subscription = { ...input, id: `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString() };
    this.records.set(input.userId, [...(this.records.get(input.userId) ?? []), record]);
    return record;
  }

  listSubscriptions(userId: string): Subscription[] { return [...(this.records.get(userId) ?? [])]; }
  getUpcomingRenewals(userId: string, limit = 5, from = new Date()): Array<Subscription & { renewalDate: string }> {
    return this.listSubscriptions(userId).filter((item) => item.active).map((item) => ({ ...item, renewalDate: renewalDate(item.billingDay, from) })).sort((a, b) => a.renewalDate.localeCompare(b.renewalDate)).slice(0, limit);
  }
  getMonthlyOverhead(userId: string): number { return this.listSubscriptions(userId).filter((item) => item.active).reduce((sum, item) => sum + item.amount, 0); }
  async exportModuleData(userId: string): Promise<Record<string, unknown>> { return { subscriptions: this.listSubscriptions(userId) }; }
  async importModuleData(userId: string, data: Record<string, unknown>): Promise<void> { const items = Array.isArray(data.subscriptions) ? data.subscriptions as Subscription[] : []; this.records.set(userId, items.map((item) => ({ ...item, userId }))); }
}

export default SubscriptionsModule;
