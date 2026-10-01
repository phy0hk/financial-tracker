import type { EncryptedCategory, EncryptedExpense, IDatabaseAdapter } from '../../db/types';
import type { DashboardWidget, IAppModule, ModuleMigrations, NavigationItem } from '../types';

export type ExpenseModuleData = {
  categories: EncryptedCategory[];
  expenses: EncryptedExpense[];
};

export class CoreExpenseModule implements IAppModule {
  readonly id = 'core-expenses';
  readonly name = 'Expenses';
  readonly description = 'Encrypted categories and expense records.';
  readonly isEnabledByDefault = true;
  readonly navigationItems: NavigationItem[] = [
    { id: 'expenses', label: 'Expenses', icon: 'wallet-cards', route: '/dashboard', order: 10 },
  ];
  readonly dashboardWidgets: DashboardWidget[] = [
    {
      id: 'expense-count',
      title: 'Expense records',
      description: 'Your encrypted transaction history',
      render: async (userId) => {
        const data = await this.read(userId);
        return { expenseCount: data.expenses.length, categoryCount: data.categories.length };
      },
    },
  ];

  private readonly memory = new Map<string, ExpenseModuleData>();

  constructor(private readonly adapter?: IDatabaseAdapter) {}

  getMigrations(): ModuleMigrations {
    return {
      sqlite: [
        `CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, userId TEXT NOT NULL, encryptedName TEXT NOT NULL, encryptedIcon TEXT, encryptedColor TEXT, createdAt TEXT NOT NULL);`,
        `CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, userId TEXT NOT NULL, categoryId TEXT, encryptedAmount TEXT NOT NULL, encryptedDescription TEXT, iv TEXT NOT NULL, authTag TEXT NOT NULL, date TEXT NOT NULL, createdAt TEXT NOT NULL, FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE SET NULL);`,
        `CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(userId);`,
        `CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(userId, date);`,
      ],
      postgres: [
        `CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "encryptedName" TEXT NOT NULL, "encryptedIcon" TEXT, "encryptedColor" TEXT, "createdAt" TIMESTAMPTZ NOT NULL);`,
        `CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "categoryId" TEXT REFERENCES categories(id) ON DELETE SET NULL, "encryptedAmount" TEXT NOT NULL, "encryptedDescription" TEXT, iv TEXT NOT NULL, "authTag" TEXT NOT NULL, date DATE NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL);`,
        `CREATE INDEX IF NOT EXISTS idx_categories_user ON categories("userId");`,
        `CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses("userId", date);`,
      ],
    };
  }

  async exportModuleData(userId: string): Promise<Record<string, unknown>> {
    return await this.read(userId);
  }

  async importModuleData(userId: string, data: Record<string, unknown>): Promise<void> {
    const categories = Array.isArray(data.categories) ? data.categories as EncryptedCategory[] : [];
    const expenses = Array.isArray(data.expenses) ? data.expenses as EncryptedExpense[] : [];
    if (this.adapter) {
      for (const category of categories) await this.adapter.addCategory({ ...category, userId, id: undefined } as Omit<EncryptedCategory, 'id'>);
      for (const expense of expenses) await this.adapter.addExpense({ ...expense, userId, id: undefined } as Omit<EncryptedExpense, 'id'>);
    } else {
      this.memory.set(userId, { categories: categories.map((item) => ({ ...item, userId })), expenses: expenses.map((item) => ({ ...item, userId })) });
    }
  }

  private async read(userId: string): Promise<ExpenseModuleData> {
    if (this.adapter) {
      const [categories, expenses] = await Promise.all([this.adapter.getCategories(userId), this.adapter.getExpenses(userId)]);
      return { categories, expenses };
    }
    return this.memory.get(userId) ?? { categories: [], expenses: [] };
  }
}

export default CoreExpenseModule;
