/**
 * CloudPostgresAdapter — remote storage for ZeroTracker.
 *
 * Implements {@link IDatabaseAdapter} by routing every operation as an HTTP
 * request to the Cloudflare Workers API backend (implemented in Section 4). The
 * client remains zero-knowledge: records are E2EE ciphertext, so this adapter
 * only moves opaque encrypted payloads over the wire.
 *
 * Authentication is bearer-token based (JWT). The token provider is invoked on
 * every request so it can refresh. The `userId` is both in the request path
 * (resource scoping) and verified server-side against the token.
 *
 * The endpoint paths used here are the API contract that Section 4 must satisfy:
 *   GET    {prefix}/users/:userId/expenses
 *   GET    {prefix}/expenses/:id
 *   POST   {prefix}/expenses
 *   PUT    {prefix}/expenses/:id
 *   DELETE {prefix}/expenses/:id
 *   GET    {prefix}/users/:userId/categories
 *   GET    {prefix}/categories/:id
 *   POST   {prefix}/categories
 *   PUT    {prefix}/categories/:id
 *   DELETE {prefix}/categories/:id
 *   GET    {prefix}/users/:userId/sync/pending
 *   POST   {prefix}/sync/mark-synced
 */

import {
  generateId,
  type EncryptedCategory,
  type EncryptedExpense,
  type IDatabaseAdapter,
} from './types';

/**
 * Configuration for {@link CloudPostgresAdapter}.
 */
export interface CloudAdapterOptions {
  /**
   * Base URL of the Cloudflare Workers API.
   * Trailing slashes are stripped.
   */
  baseUrl: string;
  /**
   * Returns the bearer token (JWT) for the authenticated user.
   * Invoked on every request so tokens can be refreshed transparently.
   */
  getToken: () => string | Promise<string>;
  /**
   * Override the `fetch` implementation. Useful for tests, custom agents, or
   * non-standard runtimes. Defaults to the global `fetch`.
   */
  fetch?: typeof fetch;
  /** API prefix. Defaults to `/v1`. */
  apiPrefix?: string;
}

/**
 * Error thrown when the backend responds with a non-2xx status.
 */
export class CloudAPIError extends Error {
  /** HTTP status code, if known. */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'CloudAPIError';
    this.status = status;
  }
}

/**
 * Remote {@link IDatabaseAdapter} backed by the Cloudflare Workers API.
 */
export class CloudPostgresAdapter implements IDatabaseAdapter {
  private readonly baseUrl: string;
  private readonly apiPrefix: string;
  private readonly getToken: () => string | Promise<string>;
  private readonly fetchImpl: typeof fetch;

  /**
   * @param options - Adapter configuration (see {@link CloudAdapterOptions}).
   */
  constructor(options: CloudAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiPrefix = options.apiPrefix ?? '/v1';
    this.getToken = options.getToken;
    this.fetchImpl = options.fetch ?? fetch;
  }

  // ---------------------------------------------------------------- expenses
  async getExpenses(userId: string): Promise<EncryptedExpense[]> {
    return this.request<EncryptedExpense[]>(
      'GET',
      `/users/${encodeURIComponent(userId)}/expenses`,
    );
  }

  async getExpenseById(id: string): Promise<EncryptedExpense | null> {
    return this.requestNullable<EncryptedExpense>(
      'GET',
      `/expenses/${encodeURIComponent(id)}`,
    );
  }

  async addExpense(
    expense: Omit<EncryptedExpense, 'id'>,
  ): Promise<EncryptedExpense> {
    // Generate the id client-side so offline-first records keep a stable id
    // across the local and cloud stores.
    const record: EncryptedExpense = { id: generateId(), ...expense };
    return this.request<EncryptedExpense>('POST', '/expenses', record);
  }

  async updateExpense(expense: EncryptedExpense): Promise<EncryptedExpense> {
    return this.request<EncryptedExpense>(
      'PUT',
      `/expenses/${encodeURIComponent(expense.id)}`,
      expense,
    );
  }

  async deleteExpense(id: string): Promise<void> {
    await this.request<void>(
      'DELETE',
      `/expenses/${encodeURIComponent(id)}`,
    );
  }

  // --------------------------------------------------------------- categories
  async getCategories(userId: string): Promise<EncryptedCategory[]> {
    return this.request<EncryptedCategory[]>(
      'GET',
      `/users/${encodeURIComponent(userId)}/categories`,
    );
  }

  async getCategoryById(id: string): Promise<EncryptedCategory | null> {
    return this.requestNullable<EncryptedCategory>(
      'GET',
      `/categories/${encodeURIComponent(id)}`,
    );
  }

  async addCategory(
    category: Omit<EncryptedCategory, 'id'>,
  ): Promise<EncryptedCategory> {
    const record: EncryptedCategory = { id: generateId(), ...category };
    return this.request<EncryptedCategory>('POST', '/categories', record);
  }

  async updateCategory(category: EncryptedCategory): Promise<EncryptedCategory> {
    return this.request<EncryptedCategory>(
      'PUT',
      `/categories/${encodeURIComponent(category.id)}`,
      category,
    );
  }

  async deleteCategory(id: string): Promise<void> {
    await this.request<void>(
      'DELETE',
      `/categories/${encodeURIComponent(id)}`,
    );
  }

  // --------------------------------------------------------------------- sync
  /**
   * Fetch the backend's pending deltas for a user.
   *
   * In `CLOUD_ONLY` mode the backend is the source of truth; in `HYBRID_SYNC`
   * this returns remote changes not yet applied to the local store. The backend
   * (Section 4) defines the exact shape of the returned object.
   */
  async getPendingSyncDeltas(
    userId: string,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      'GET',
      `/users/${encodeURIComponent(userId)}/sync/pending`,
    );
  }

  /**
   * Tell the backend that the given record ids have been synced.
   */
  async markSynced(ids: string[]): Promise<void> {
    await this.request<void>('POST', '/sync/mark-synced', { ids });
  }

  // ----------------------------------------------------------------- private
  /**
   * Perform an authenticated JSON request.
   *
   * @param method - HTTP verb.
   * @param path - Path relative to the API prefix.
   * @param body - Optional JSON-serializable request body.
   * @returns The parsed JSON response (or `undefined` for 204 responses).
   * @throws {CloudAPIError} On any non-2xx response.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.getToken();
    const url = `${this.baseUrl}${this.apiPrefix}${path}`;

    const res = await this.fetchImpl(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new CloudAPIError(
        `API request failed: ${method} ${path} -> ${res.status} ${res.statusText}${
          detail ? `: ${detail}` : ''
        }`,
        res.status,
      );
    }

    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  /**
   * Like {@link request} but treats a 404 as "not found" and returns `null`
   * instead of throwing. Used by the `getById` lookups.
   */
  private async requestNullable<T>(method: string, path: string): Promise<T | null> {
    try {
      return await this.request<T>(method, path);
    } catch (error) {
      if (error instanceof CloudAPIError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }
}
