/**
 * Which database this is, read from the database rather than from `.env`.
 *
 * `infra/postgres/init/10-roles.sh` runs `ALTER DATABASE … SET
 * lustre.environment`, so every session on that database sees the value no
 * matter which connection string reached it. A guard that trusted the URL
 * would follow a copied `.env`, or a hostname like `db` that means "local" on a
 * laptop and "the clinic" inside the production stack, straight into patient
 * data.
 */
import type postgres from 'postgres';

export type DatabaseEnvironment = 'production' | 'development' | 'unmarked';

export async function databaseEnvironment(client: postgres.Sql): Promise<DatabaseEnvironment> {
    const [row] = await client<{ value: string | null }[]>`
        SELECT current_setting('lustre.environment', true) AS value
    `;
    const value = row?.value?.trim();
    if (value === 'production') return 'production';
    if (value === 'development') return 'development';
    return 'unmarked';
}

/** For anything that deletes rows wholesale: the seed, the test suite's truncation. */
export async function refuseProduction(client: postgres.Sql, action: string): Promise<void> {
    if ((await databaseEnvironment(client)) === 'production') {
        throw new Error(`refusing to ${action}: this is the production database`);
    }
}
