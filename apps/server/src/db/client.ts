import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { Env } from '../types';
import * as schema from './schema';

export function createDatabase(env: Env['Bindings']) {
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL or HYPERDRIVE binding is required');
  }
  return drizzle(neon(connectionString), { schema });
}

export type Database = ReturnType<typeof createDatabase>;
