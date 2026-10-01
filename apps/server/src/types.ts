import type { MiddlewareHandler } from 'hono';
import type { Database } from './db/client';
import type { User } from './db/schema';

export type Env = {
  Bindings: {
    DATABASE_URL?: string;
    JWT_SECRET: string;
    ACCESS_TOKEN_TTL?: string;
    REFRESH_TOKEN_TTL?: string;
    COOKIE_SECURE?: string;
    CORS_ORIGIN?: string;
    HYPERDRIVE?: { connectionString: string };
  };
  Variables: {
    user: Pick<User, 'id' | 'role'>;
    db: Database;
  };
};

export type AppMiddleware = MiddlewareHandler<Env>;
