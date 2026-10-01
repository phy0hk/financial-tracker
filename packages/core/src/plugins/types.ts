/**
 * Plugin architecture contracts.
 *
 * An {@link IAppModule} is a self-contained, optional feature that the core
 * application can discover, enable/disable, migrate, and (de)serialize. Modules
 * are the unit of extensibility: each one owns its own database migrations,
 * optional server routes, data export/import, and any UI it contributes.
 *
 * The core never hard-codes a specific module. It only knows these contracts,
 * which keeps the plugin system decoupled from concrete features.
 */

/**
 * A dashboard widget contributed by a module.
 *
 * Widgets are rendered on the user's dashboard. The `render` function is
 * framework-agnostic: it receives the current user's scoped data and returns a
 * serializable description the host UI can render.
 */
export interface DashboardWidget {
  /** Stable, unique widget id within the owning module (e.g. "spend-summary"). */
  id: string;
  /** Human-readable title shown in the widget header. */
  title: string;
  /** Optional short description / subtitle. */
  description?: string;
  /**
   * Grid span (number of columns) the widget should occupy. Defaults to 1.
   * Clamped by the host to the dashboard's column count.
   */
  span?: number;
  /**
   * Produce the widget's display data for a given user.
   *
   * @param userId - The user whose dashboard is being rendered.
   * @returns A serializable payload describing what to display.
   */
  render(userId: string): Promise<Record<string, unknown>>;
}

/**
 * A navigation item contributed by a module to the app's main navigation.
 */
export interface NavigationItem {
  /** Stable, unique item id within the owning module. */
  id: string;
  /** Label shown in the navigation. */
  label: string;
  /** Optional icon identifier understood by the host UI. */
  icon?: string;
  /** Route / view identifier the host navigates to when the item is selected. */
  route: string;
  /** Optional ordering hint; lower values sort first. Defaults to 100. */
  order?: number;
}

/**
 * A settings tab contributed by a module to the app's settings screen.
 */
export interface SettingsTab {
  /** Stable, unique tab id within the owning module. */
  id: string;
  /** Label shown on the settings tab. */
  label: string;
  /** Optional icon identifier understood by the host UI. */
  icon?: string;
  /**
   * Produce the settings tab's content for a given user.
   *
   * @param userId - The user whose settings are being shown.
   * @returns A serializable payload describing the tab's fields/values.
   */
  render(userId: string): Promise<Record<string, unknown>>;
}

/**
 * Migrations a module contributes, split by backend.
 *
 * Each array is an ordered list of SQL statements (or migration units) that the
 * storage layer applies in sequence. Keeping `sqlite` and `postgres` separate
 * lets each backend use its own dialect without the module branching on it.
 */
export interface ModuleMigrations {
  /** Ordered SQL migration statements for the SQLite backend. */
  sqlite: string[];
  /** Ordered SQL migration statements for the Postgres backend. */
  postgres: string[];
}

/**
 * A pluggable application module.
 *
 * Implementations are registered with a {@link PluginManager} (see
 * `PluginManager.ts`). The manager is responsible for lifecycle orchestration:
 * running migrations, toggling enablement, and aggregating data across all
 * active modules.
 */
export interface IAppModule {
  /** Stable, unique module id (e.g. "budgets", "recurring"). Used as the key. */
  id: string;
  /** Human-readable module name (e.g. "Budgets"). */
  name: string;
  /** Short description of what the module provides. */
  description: string;
  /**
   * Whether the module is enabled by default on a fresh install.
   * Modules that are off by default must still be registered to be available.
   */
  isEnabledByDefault: boolean;

  /**
   * Return the module's database migrations for each supported backend.
   *
   * The storage layer runs these in order when the module is first enabled.
   * Migrations must be idempotent or guarded so re-running is safe.
   */
  getMigrations(): ModuleMigrations;

  /**
   * Optionally register server-side routes for this module.
   *
   * @param app - The host application/router instance. Typed as `any` to keep
   *   the contract framework-agnostic (Express, Hono, Fastify, etc.).
   */
  registerServerRoutes?(app: any): void;

  /**
   * Export this module's data for a user, keyed by logical collection.
   *
   * @param userId - The user whose data is being exported.
   * @returns A record of collection name -> rows (or any serializable value).
   */
  exportModuleData(userId: string): Promise<Record<string, unknown>>;

  /**
   * Import this module's data for a user from a previously exported record.
   *
   * @param userId - The user whose data is being imported.
   * @param data - The record produced by {@link exportModuleData}.
   */
  importModuleData(
    userId: string,
    data: Record<string, unknown>,
  ): Promise<void>;

  /** Dashboard widgets contributed by this module. */
  dashboardWidgets?: DashboardWidget[];
  /** Navigation items contributed by this module. */
  navigationItems?: NavigationItem[];
  /** Settings tab contributed by this module (at most one). */
  settingsTab?: SettingsTab;
}
