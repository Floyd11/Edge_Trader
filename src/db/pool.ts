// src/db/pool.ts
// Singleton PostgreSQL connection pool.
// Import `pool` wherever queries are needed; never create new Pool instances.

import { Pool } from 'pg';
import { env } from '../config/env';

export const pool = new Pool({
  connectionString: env.BOT_DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Surface connection errors early rather than silently letting them pile up
pool.on('error', (err) => {
  console.error('[DB] Unexpected idle client error:', err.message);
});
