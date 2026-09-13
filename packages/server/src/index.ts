/**
 * Entrypoint (SPEC §4): migrate → background services → listen.
 *
 * Background services live in `background/`. The reminder job lands here once
 * it exists.
 *
 * Ordering matters: monitoring starts before anything else so a startup
 * failure is reported (§17), and the single settings row is seeded before
 * anything reads it (§5, §12).
 */
import { startBackupJob } from './background/backup.job.ts';
import { config } from './config.ts';
import { runMigrations } from './db/migrate.ts';
import { logger } from './logger.ts';
import { settingsService } from './modules/settings/settings.service.ts';
import { alert, startMonitoring, stopMonitoring } from './monitoring/index.ts';
import { createServer } from './server.ts';

startMonitoring();

// Off in production, where the server's role cannot change the schema and the
// deploy runs `scripts/migrate.ts` as the owner before starting it.
if (config.MIGRATE_ON_BOOT) {
    try {
        await runMigrations();
        logger.info('migrations applied');
    } catch (err) {
        logger.fatal({ err }, 'migration failed');
        await alert({
            code: 'db.migration_failed',
            summary: 'Migrations failed on boot. The server did not start.',
            context: { error: err instanceof Error ? err.name : typeof err },
        });
        process.exit(1);
    }
} else {
    logger.info('migrations skipped on boot (MIGRATE_ON_BOOT=false)');
}

await settingsService.ensureSeeded();

const backupJob = startBackupJob();

const server = createServer();

logger.info({ port: server.port }, 'lustre server listening');

function shutdown(signal: string) {
    logger.info({ signal }, 'shutting down');
    backupJob.stop();
    stopMonitoring();
    server.stop();
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { config };
