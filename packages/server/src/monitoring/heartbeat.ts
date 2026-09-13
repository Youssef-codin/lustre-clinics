/**
 * SPEC §17 — the external check that the machine is responding. It catches
 * power cuts, crashes, and network failure, which the app cannot report itself.
 *
 * Nothing can reach the clinic machine from outside the tailnet, so the check
 * is inverted: the server pings out on an interval and the monitor
 * (UptimeRobot heartbeat, or any equivalent) alerts on silence. A failed ping
 * is logged, never alerted — if the network is down the alert cannot leave
 * either, and silence is exactly the signal the monitor is watching for.
 *
 * A process that answers is not a clinic that works: with Postgres down the
 * server stays up and would keep pinging while every screen fails. `isHealthy`
 * is asked before each ping, and an unhealthy server stays silent so the monitor
 * raises the alarm. It must not throw; `healthService.check` does not.
 *
 * The timer is `unref`'d so the heartbeat is never the reason the process stays
 * alive.
 */
import { logger } from '../logger.ts';

export interface HeartbeatOptions {
    url: string;
    intervalMs: number;
    isHealthy?: () => Promise<boolean>;
    fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface Heartbeat {
    ping(): Promise<boolean>;
    stop(): void;
}

export function startHeartbeat(options: HeartbeatOptions): Heartbeat {
    const { url, intervalMs, isHealthy, fetchImpl = fetch } = options;

    async function ping(): Promise<boolean> {
        if (isHealthy && !(await isHealthy())) {
            logger.warn('heartbeat withheld: the server is not healthy');
            return false;
        }
        try {
            const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
            if (!res.ok) {
                logger.warn({ status: res.status }, 'heartbeat rejected');
                return false;
            }
            logger.debug('heartbeat sent');
            return true;
        } catch (err) {
            logger.warn({ err }, 'heartbeat failed');
            return false;
        }
    }

    void ping();
    const timer = setInterval(() => void ping(), intervalMs);
    timer.unref?.();

    logger.info({ intervalSeconds: intervalMs / 1000 }, 'heartbeat started');

    return {
        ping,
        stop() {
            clearInterval(timer);
        },
    };
}
