/**
 * Drizzle over `postgres.js` (SPEC §2). Bun's native `Bun.sql` +
 * `drizzle-orm/bun-sql` is the newer alternative; `postgres.js` is the
 * documented default and is what this runs on until that matures.
 *
 * The pool is sized for two clients on a tailnet: a small pool keeps the
 * clinic machine's memory use predictable. `Executor` is either the pool or an
 * open transaction, so a multi-table operation (a walk-in creating an
 * appointment and a visit together, §7) composes without duplicating queries.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config.ts';
import { schema } from './schema.ts';

export const sql = postgres(config.DATABASE_URL, {
    max: 10,
    onnotice: () => {},
});

export const db = drizzle(sql, { schema });

export type Db = typeof db;

export type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
