/**
 * PluginManager — lifecycle orchestration for application modules.
 *
 * The manager owns the registry of {@link IAppModule}s and their enablement
 * state. It is deliberately storage-agnostic: enablement state is persisted
 * through a {@link PluginStateStore} so the same manager works in-memory
 * (tests, server) and against `localStorage` (browser).
 *
 * A module is *active* when it is registered **and** enabled. All aggregators
 * (migrations, widgets, data export/import) operate only on active modules.
 */

import type {
  DashboardWidget,
  IAppModule,
  ModuleMigrations,
} from './types';

/**
 * Persistence abstraction for module enablement state.
 *
 * Implementations must be synchronous so the manager can read/write state
 * without awaiting. The value is a JSON-serializable record of module id ->
 * enabled flag.
 */
export interface PluginStateStore {
  /** Read the persisted enablement map. Returns `{}` when nothing is stored. */
  load(): Record<string, boolean>;
  /** Persist the enablement map. */
  save(state: Record<string, boolean>): void;
}

/**
 * In-memory {@link PluginStateStore}.
 *
 * Useful for tests and for server-side instances where per-process memory is
 * an acceptable source of truth.
 */
export class MemoryPluginStateStore implements PluginStateStore {
  private state: Record<string, boolean>;

  constructor(initial?: Record<string, boolean>) {
    this.state = initial ? { ...initial } : {};
  }

  load(): Record<string, boolean> {
    return { ...this.state };
  }

  save(state: Record<string, boolean>): void {
    this.state = { ...state };
  }
}

/**
 * `localStorage`-backed {@link PluginStateStore}.
 *
 * Falls back to an in-memory map when `localStorage` is unavailable (e.g. SSR,
 * non-browser runtimes) so the manager never throws in those environments.
 */
export class LocalStoragePluginStateStore implements PluginStateStore {
  private readonly key: string;
  private readonly fallback: MemoryPluginStateStore;

  constructor(storageKey = 'zerotracker.plugin-state') {
    this.key = storageKey;
    this.fallback = new MemoryPluginStateStore();
  }

  private get storage(): Storage | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  }

  load(): Record<string, boolean> {
    const storage = this.storage;
    if (!storage) return this.fallback.load();

    try {
      const raw = storage.getItem(this.key);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, boolean>;
      }
      return {};
    } catch {
      return {};
    }
  }

  save(state: Record<string, boolean>): void {
    const storage = this.storage;
    if (!storage) {
      this.fallback.save(state);
      return;
    }
    try {
      storage.setItem(this.key, JSON.stringify(state));
    } catch {
      // Storage may be full or blocked; keep the in-memory copy so the
      // current session still behaves consistently.
      this.fallback.save(state);
    }
  }
}

/**
 * Aggregated enablement + registry view returned by {@link PluginManager}.
 */
export interface PluginSnapshot {
  /** All registered module ids. */
  registered: string[];
  /** All active (registered + enabled) module ids. */
  active: string[];
  /** Enablement flag per registered module id. */
  enabled: Record<string, boolean>;
}

/**
 * Orchestrates application modules: registration, enablement, and aggregation
 * of migrations, UI extensions, and data (de)serialization.
 */
export class PluginManager {
  private readonly modules = new Map<string, IAppModule>();
  private readonly store: PluginStateStore;

  constructor(store?: PluginStateStore) {
    this.store = store ?? new MemoryPluginStateStore();
  }

  /**
   * Register a module.
   *
   * If the module has no persisted enablement state yet, it defaults to its
   * `isEnabledByDefault` flag. Re-registering an existing id replaces the
   * module instance but preserves its enablement state.
   *
   * @param module - The module to register.
   * @throws {Error} If a module with the same id is already registered with a
   *   different identity is not allowed — duplicates overwrite, so no throw.
   */
  register(module: IAppModule): void {
    this.modules.set(module.id, module);
    this.persist();
  }

  /**
   * Register many modules at once.
   *
   * @param modules - Modules to register.
   */
  registerAll(modules: IAppModule[]): void {
    for (const module of modules) {
      this.register(module);
    }
  }

  /**
   * Unregister a module, removing it from the registry and from persisted
   * enablement state.
   *
   * @param id - The module id to remove.
   * @returns `true` if the module was registered, `false` otherwise.
   */
  unregister(id: string): boolean {
    const existed = this.modules.delete(id);
    if (existed) {
      this.persist();
    }
    return existed;
  }

  /**
   * @param id - The module id to look up.
   * @returns The registered module, or `undefined` if not registered.
   */
  getModule(id: string): IAppModule | undefined {
    return this.modules.get(id);
  }

  /**
   * @returns All registered modules, in registration order.
   */
  getAllModules(): IAppModule[] {
    return [...this.modules.values()];
  }

  /**
   * @param id - The module id to check.
   * @returns Whether the module is currently enabled. Unknown modules are
   *   treated as disabled.
   */
  isEnabled(id: string): boolean {
    if (!this.modules.has(id)) return false;
    const state = this.store.load();
    return state[id] !== false;
  }

  /**
   * Enable a module.
   *
   * @param id - The module id to enable.
   * @returns `true` if the module is registered, `false` otherwise.
   */
  enable(id: string): boolean {
    if (!this.modules.has(id)) return false;
    const state = this.store.load();
    state[id] = true;
    this.store.save(state);
    return true;
  }

  /**
   * Disable a module.
   *
   * @param id - The module id to disable.
   * @returns `true` if the module is registered, `false` otherwise.
   */
  disable(id: string): boolean {
    if (!this.modules.has(id)) return false;
    const state = this.store.load();
    state[id] = false;
    this.store.save(state);
    return true;
  }

  /**
   * @param id - The module id to check.
   * @returns `true` when the module is registered and enabled.
   */
  isActive(id: string): boolean {
    return this.modules.has(id) && this.isEnabled(id);
  }

  /**
   * @returns All active modules, in registration order.
   */
  getActiveModules(): IAppModule[] {
    return this.getAllModules().filter((m) => this.isActive(m.id));
  }

  /**
   * @returns A snapshot of the registry and enablement state.
   */
  getSnapshot(): PluginSnapshot {
    const registered = [...this.modules.keys()];
    const active = registered.filter((id) => this.isActive(id));
    const enabled: Record<string, boolean> = {};
    for (const id of registered) {
      enabled[id] = this.isEnabled(id);
    }
    return { registered, active, enabled };
  }

  /**
   * Aggregate the migrations of all active modules.
   *
   * Migrations are concatenated in registration order so the storage layer can
   * apply them deterministically. Use {@link getMigrationsByModule} when the
   * storage layer needs to track which module's migrations have been applied.
   *
   * @returns Combined `sqlite` and `postgres` migration lists.
   */
  getAllMigrations(): ModuleMigrations {
    const sqlite: string[] = [];
    const postgres: string[] = [];
    for (const module of this.getActiveModules()) {
      const migrations = module.getMigrations();
      sqlite.push(...migrations.sqlite);
      postgres.push(...migrations.postgres);
    }
    return { sqlite, postgres };
  }

  /**
   * Aggregate migrations keyed by module id, for active modules only.
   *
   * @returns A map of module id -> that module's migrations.
   */
  getMigrationsByModule(): Record<string, ModuleMigrations> {
    const result: Record<string, ModuleMigrations> = {};
    for (const module of this.getActiveModules()) {
      result[module.id] = module.getMigrations();
    }
    return result;
  }

  /**
   * Aggregate dashboard widgets from all active modules.
   *
   * @returns A flat list of widgets, in registration order.
   */
  getActiveWidgets(): DashboardWidget[] {
    const widgets: DashboardWidget[] = [];
    for (const module of this.getActiveModules()) {
      if (module.dashboardWidgets) {
        widgets.push(...module.dashboardWidgets);
      }
    }
    return widgets;
  }

  /**
   * Export data for a user across all active modules.
   *
   * @param userId - The user whose data is being exported.
   * @returns A record of module id -> that module's exported data. Modules that
   *   throw are captured as `{ error }` so one failing module does not abort
   *   the whole export.
   */
  async exportAllData(
    userId: string,
  ): Promise<Record<string, Record<string, unknown>>> {
    const result: Record<string, Record<string, unknown>> = {};
    for (const module of this.getActiveModules()) {
      try {
        result[module.id] = await module.exportModuleData(userId);
      } catch (error) {
        result[module.id] = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return result;
  }

  /**
   * Import data for a user across all active modules.
   *
   * @param userId - The user whose data is being imported.
   * @param data - A record of module id -> that module's data (as produced by
   *   {@link exportAllData}). Modules absent from `data` are skipped.
   * @returns A report of which modules imported successfully and which failed.
   */
  async importAllData(
    userId: string,
    data: Record<string, Record<string, unknown>>,
  ): Promise<Record<string, { ok: boolean; error?: string }>> {
    const report: Record<string, { ok: boolean; error?: string }> = {};
    for (const module of this.getActiveModules()) {
      const slice = data[module.id];
      if (!slice) {
        report[module.id] = { ok: true };
        continue;
      }
      try {
        await module.importModuleData(userId, slice);
        report[module.id] = { ok: true };
      } catch (error) {
        report[module.id] = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return report;
  }

  /**
   * Persist the current enablement state, initializing any registered module
   * that has no stored flag to its `isEnabledByDefault` value.
   */
  private persist(): void {
    const state = this.store.load();
    let changed = false;
    for (const module of this.modules.values()) {
      if (!(module.id in state)) {
        state[module.id] = module.isEnabledByDefault;
        changed = true;
      }
    }
    if (changed) {
      this.store.save(state);
    }
  }
}
