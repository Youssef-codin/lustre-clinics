/**
 * SPEC §16 — `pg_dump` on a schedule inside the compose stack, and an alert
 * when no backup has succeeded in 48h.
 *
 * The schedule is an interval rather than a cron expression, so a machine that
 * was off at the wall-clock hour still backs up. But an interval counts from
 * boot, and the clinic machine loses power more often than once a day: every
 * restart put the next backup a full interval away, so a clinic with daily
 * power cuts would never back up at all. A backup that is already due therefore
 * runs at boot, and the staleness check waits for it rather than alerting about
 * a gap the boot run is about to close.
 *
 * `runBackup` already logs and alerts a failed run; `runNow` swallows the
 * rejection so one bad night cannot take the interval, and every later backup,
 * down with it.
 */
import { readLastSuccess, runBackup } from '../backup/index.ts';
import { config } from '../config.ts';
import { logger } from '../logger.ts';
import { alert } from '../monitoring/index.ts';

export interface BackupJob {
    runNow(): Promise<boolean>;
    stop(): void;
}

/** Due when nothing has ever succeeded, or the last success is an interval old. */
export function isBackupDue(lastSuccessAt: string | null, now: number, intervalMs: number): boolean {
    if (!lastSuccessAt) return true;
    const at = new Date(lastSuccessAt).getTime();
    if (Number.isNaN(at)) return true;
    return now - at >= intervalMs;
}

export function startBackupJob(): BackupJob {
    const intervalMs = config.BACKUP_INTERVAL_HOURS * 3_600_000;
    const staleAfterMs = config.BACKUP_STALE_AFTER_HOURS * 3_600_000;

    async function runNow(): Promise<boolean> {
        return runBackup().then(
            () => true,
            () => false,
        );
    }

    async function checkStaleness(): Promise<void> {
        const last = await readLastSuccess();
        const ageMs = last ? Date.now() - new Date(last.at).getTime() : Number.POSITIVE_INFINITY;

        if (ageMs > staleAfterMs) {
            await alert({
                code: 'backup.stale',
                summary: 'No backup has succeeded recently.',
                context: {
                    lastSuccessAt: last?.at ?? null,
                    thresholdHours: config.BACKUP_STALE_AFTER_HOURS,
                },
            });
        }
    }

    void readLastSuccess().then((last) => {
        if (isBackupDue(last?.at ?? null, Date.now(), intervalMs)) {
            logger.info({ lastSuccessAt: last?.at ?? null }, 'backup due at boot');
            return runNow().then(checkStaleness);
        }
        return checkStaleness();
    });

    const timer = setInterval(() => {
        void runNow().then(checkStaleness);
    }, intervalMs);
    timer.unref?.();

    logger.info({ intervalHours: config.BACKUP_INTERVAL_HOURS }, 'backup job started');

    return {
        runNow,
        stop() {
            clearInterval(timer);
        },
    };
}
