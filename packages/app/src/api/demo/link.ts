/**
 * The terminating tRPC link that answers out of `./handlers` instead of over
 * HTTP.
 *
 * Two things make what comes out of here the same shape as what comes out of
 * the clinic server, which is the whole point of doing it at this level rather
 * than stubbing each screen's data layer:
 *
 * - **The wire's types, not the handlers'.** The handlers deal in `Date`,
 *   because the services they mirror do. There is no transformer on either side
 *   (`api/types.ts`), so a `timestamptz` reaches the app as the ISO string JSON
 *   made of it, and every screen already parses one. `toWire` is that JSON
 *   round trip, so demo mode cannot be the one place a date arrives as an
 *   object.
 * - **The client's error contract.** A failure comes back as a
 *   `TRPCClientError` carrying `data.appCode`, which is what `errors.ts`
 *   classifies and what every screen localizes from. A demo that threw plain
 *   `Error`s would take every refusal — a double booking, a payment over the
 *   balance — to the generic failure message.
 *
 * The delay is deliberate. The screens have pending states written for a round
 * trip over Tailscale, and answering in under a millisecond does not exercise
 * them: buttons never show their spinner, and optimistic updates land before
 * anyone sees the transition. This is a fifth of the realistic worst case,
 * which is enough for those states to read as intended without the demo feeling
 * slow.
 */
import type { AppRouter } from '@lustre/server/src/trpc/router.ts';
import { ERROR_CODE, type ErrorCode } from '@lustre/shared';
import { TRPCClientError, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { getDb, isOpen, loadStored, setDb } from './db';
import { hasHandler, resolve } from './handlers';
import { DemoError } from './rules';
import { seedDemoDb } from './seed';

const LATENCY_MS = { query: 120, mutation: 240 } as const;

/** JSONRPC2 error codes, picked the way the server's `trpcCodeFor` picks them. */
const TRPC_CODE: Record<number, number> = {
    404: -32004,
    409: -32009,
    422: -32022,
    500: -32603,
};

function toWire(value: unknown): unknown {
    return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as unknown);
}

function failure(path: string, error: unknown): TRPCClientError<AppRouter> {
    const demo = error instanceof DemoError ? error : null;
    const appCode: ErrorCode = demo?.code ?? ERROR_CODE.INTERNAL;
    const httpStatus = demo?.httpStatus ?? 500;
    const message = error instanceof Error ? error.message : 'demo backend failed';

    return TRPCClientError.from({
        error: {
            code: TRPC_CODE[httpStatus] ?? -32600,
            message,
            data: { appCode, httpStatus, code: appCode, path },
        },
    });
}

let opening: Promise<void> | null = null;

/**
 * Opened once, on the first request rather than at import: a seed that runs
 * during module evaluation runs on every launch of the real app too.
 */
function openDemoDb(): Promise<void> {
    if (isOpen()) return Promise.resolve();
    if (opening) return opening;

    opening = loadStored()
        .then((stored) => {
            setDb(stored ?? seedDemoDb());
        })
        .finally(() => {
            opening = null;
        });

    return opening;
}

export const demoLink: TRPCLink<AppRouter> = () => {
    return ({ op }) =>
        observable((observer) => {
            let cancelled = false;

            const run = async () => {
                await openDemoDb();

                const wait = op.type === 'mutation' ? LATENCY_MS.mutation : LATENCY_MS.query;
                await new Promise((done) => setTimeout(done, wait));

                if (cancelled || op.signal?.aborted) return;

                if (!hasHandler(op.path)) {
                    throw new DemoError(ERROR_CODE.NOT_FOUND, `${op.path} is not answered in demo mode`, 404);
                }

                // Read once here rather than inside every handler: `getDb`
                // throws until the open above has finished.
                getDb();

                return toWire(resolve(op.path, op.input));
            };

            run().then(
                (data) => {
                    if (cancelled) return;
                    observer.next({ result: { type: 'data', data } });
                    observer.complete();
                },
                (error: unknown) => {
                    if (cancelled) return;
                    observer.error(failure(op.path, error));
                },
            );

            return () => {
                cancelled = true;
            };
        });
};
