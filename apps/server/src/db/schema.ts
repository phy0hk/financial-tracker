/**
 * Drizzle ORM schema for the ZeroTracker PostgreSQL backend.
 *
 * This is the source of truth for the cloud database. Column names use
 * snake_case on the wire; Drizzle maps them to the camelCase keys used by the
 * {@link import("@zerotracker/core").EncryptedExpense} / `EncryptedCategory`
 * record types in `packages/core`.
 *
 * Financial fields are E2EE ciphertext — the server stores opaque base64
 * values and never decrypts them (zero-knowledge).
 */

import {
  boolean,

  pgEnum,
  pgTable,
  primaryKey,

  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Auth role values.
 */
export const userRole = pgEnum('user_role', ['user', 'admin']);

/**
 * Users table.
 *
 * `email`, `passwordHash`, `salt`, `role` are the server-side auth material.
 * The user's financial data is never stored here — it lives in the
 * category/expense tables as ciphertext.
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull().default('user'),
  salt: text('salt').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * Categories table. All display fields are encrypted client-side.
 */
export const categories = pgTable(
  'categories',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    encryptedName: text('encrypted_name').notNull(),
    encryptedIcon: text('encrypted_icon'),
    encryptedColor: text('encrypted_color'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
);

/**
 * Expenses table.
 *
 * `encryptedAmount` / `encryptedDescription` are AES-GCM-256 ciphertexts from a
 * single payload; `iv` and `authTag` are the shared nonce/auth tag.
 */
export const expenses = pgTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    encryptedAmount: text('encrypted_amount').notNull(),
    encryptedDescription: text('encrypted_description'),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    date: timestamp('date').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
);

/**
 * Per-user module enablement.
 *
 * Composite primary key `(userId, moduleId)`. Drives which plugins are active
 * for a given user (mirrors `local_user_modules` on-device).
 */
export const userModules = pgTable(
  'user_modules',
  {
    userId: text('user_id').notNull(),
    moduleId: text('module_id').notNull(),
    isEnabled: boolean('is_enabled').notNull().default(true),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userModulesPk: primaryKey({ columns: [table.userId, table.moduleId] }),
  }),
);

/**
 * Infer row types from the schema for use in queries.
 */
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
export type UserModule = typeof userModules.$inferSelect;
export type NewUserModule = typeof userModules.$inferInsert;
