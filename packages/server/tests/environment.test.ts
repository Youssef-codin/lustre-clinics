import { afterEach, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { config } from '../src/config.ts';
import { databaseEnvironment, refuseProduction } from '../src/db/environment.ts';

/**
 * The production marker is what stops the seed and the suite's truncation from
 * running against the clinic's data, whatever the connection string says. The
 * init script sets it per database; here it is set per session, on a
 * single-connection client so the setting and the check share a backend.
 */

let client: postgres.Sql | undefined;

function connect(): postgres.Sql {
    client = postgres(config.DATABASE_URL, { max: 1, onnotice: () => {} });
    return client;
}

afterEach(async () => {
    await client?.end();
    client = undefined;
});

describe('database environment marker', () => {
    test('an unmarked database is not production, and is not refused', async () => {
        const db = connect();
        expect(await databaseEnvironment(db)).toBe('unmarked');
        await refuseProduction(db, 'seed');
    });

    test('a database marked development is allowed', async () => {
        const db = connect();
        await db`SELECT set_config('lustre.environment', 'development', false)`;
        expect(await databaseEnvironment(db)).toBe('development');
        await refuseProduction(db, 'seed');
    });

    test('a database marked production is refused', async () => {
        const db = connect();
        await db`SELECT set_config('lustre.environment', 'production', false)`;
        expect(await databaseEnvironment(db)).toBe('production');
        expect(refuseProduction(db, 'seed')).rejects.toThrow(
            'refusing to seed: this is the production database',
        );
    });
});
