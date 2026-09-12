/**
 * SPEC §13/§14. The client probes this on both the LAN address and the
 * Tailscale hostname and uses whichever answers first, so it must be cheap and
 * must not throw — an unreachable database is a reportable state, not an error.
 */
import { sql as raw } from 'drizzle-orm';
import { tailnetAddress } from '../../config.ts';
import { db, sql } from '../../db/index.ts';

interface HealthReport {
    ok: boolean;
    db: boolean;
    migration: string | null;
    /**
     * Where to reach this machine from elsewhere on the tailnet, or `null` when
     * the clinic has not said. The app stores it so the address is configured
     * once here rather than on every phone, and re-reads it on each connection
     * so moving the server is a one-line change the handsets pick up by
     * themselves.
     */
    tailscale: string | null;
}

export const healthService = {
    async check(): Promise<HealthReport> {
        let dbOk = false;
        let migration: string | null = null;

        try {
            await db.execute(raw`SELECT 1`);
            dbOk = true;

            const rows = await sql<{ hash: string; created_at: string }[]>`
                SELECT hash, created_at
                FROM drizzle.__drizzle_migrations
                ORDER BY created_at DESC
                LIMIT 1
            `;
            migration = rows[0]?.hash ?? null;
        } catch {}

        return { ok: dbOk, db: dbOk, migration, tailscale: tailnetAddress };
    },
};
