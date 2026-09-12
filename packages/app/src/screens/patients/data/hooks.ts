/**
 * Every read and write this cluster makes, over TanStack Query. It replaces
 * `_LocalQuery.ts` — a hand-rolled pair of hooks written when TanStack was not
 * a dependency (F2) and shaped like it so the swap would be mechanical. It is,
 * and this is it: the names and the return shapes are the ones the screens
 * already destructure, so the three of them changed an import and a call
 * signature and nothing else.
 *
 * The one signature change is the key. `_LocalQuery` took a `deps` array, and
 * three separate reads on this cluster passed `[]` — fine for a hook with no
 * cache, and a collision the moment there is one. The key is explicit and
 * cluster-prefixed now, which is also what makes a targeted invalidation
 * possible later.
 *
 * What the screens get that they did not have: a cache, so reopening a record
 * paints from what is already known while the re-read is in flight, and
 * `refetch` on a query that is on screen rather than a fresh run of everything.
 *
 * `loading` stays "no data yet, and something is actually in flight" — TanStack's
 * `isLoading`, not `isPending`, because a disabled query is pending forever and
 * `PatientEditScreen` ors that into a spinner while registering a new patient.
 *
 * `error` is normalized to `undefined` rather than `null` so `errorText` and the
 * `!== undefined` checks in the editor keep reading the way they read. Errors
 * arrive as `PatientsRequestError`, carrying an `ERROR_CODE` — the client
 * localizes from the code and never parses the server's message (§4, §14).
 */
import {
    useQueryClient,
    useMutation as useTanstackMutation,
    useQuery as useTanstackQuery,
} from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

/** Everything this cluster caches sits under one root, so a sign-out can drop it in one call. */
const PATIENTS_KEY = 'patients';

export interface QueryResult<T> {
    data: T | undefined;
    error: Error | undefined;
    loading: boolean;
    refetch: () => void;
}

export function useQuery<T>(
    key: readonly unknown[],
    run: () => Promise<T>,
    options: { enabled?: boolean } = {},
): QueryResult<T> {
    const query = useTanstackQuery({
        queryKey: [PATIENTS_KEY, ...key],
        queryFn: run,
        enabled: options.enabled ?? true,
    });

    return {
        data: query.data,
        error: query.error ?? undefined,
        loading: query.isLoading,
        refetch: () => void query.refetch(),
    };
}

export interface MutationResult<TInput, TOutput> {
    mutate: (input: TInput) => Promise<TOutput | undefined>;
    pending: boolean;
    error: Error | undefined;
    reset: () => void;
}

/**
 * A write, and the guarantee the screens depend on: a failure resolves to
 * `undefined` rather than throwing, so a caller can close a sheet on success
 * without standing in front of a rejection, and an overlapping call is refused
 * rather than queued — every write crosses Tailscale, and the second tap on a
 * payment is the one that takes the money twice.
 *
 * The in-flight flag is a ref, not `isPending`: the callback would close over
 * yesterday's value of a state field and let the second tap through.
 */
export function useMutation<TInput, TOutput>(
    run: (input: TInput) => Promise<TOutput>,
): MutationResult<TInput, TOutput> {
    const invalidate = useInvalidatePatients();

    // Every write this cluster makes moves more than the thing it wrote: a
    // correction moves the record and the list's recent page, a payment moves
    // the record, its history and the outstanding column. There are three of
    // them, they all cross Tailscale anyway, and invalidating the root is
    // cheaper than being right about which reads each one touched — and than
    // discovering a year from now that one call site forgot.
    const mutation = useTanstackMutation({ mutationFn: run, onSuccess: invalidate });
    const inFlight = useRef(false);

    const { mutateAsync } = mutation;
    const mutate = useCallback(
        async (input: TInput) => {
            if (inFlight.current) return undefined;
            inFlight.current = true;

            const result = await mutateAsync(input).catch(() => undefined);
            inFlight.current = false;
            return result;
        },
        [mutateAsync],
    );

    return {
        mutate,
        pending: mutation.isPending,
        error: mutation.error ?? undefined,
        reset: mutation.reset,
    };
}

/**
 * Drop everything this cluster has cached. `useMutation` calls it on every
 * successful write; `PatientsCluster` calls it for the writes that happen
 * somewhere else and come back as a remount.
 */
export function useInvalidatePatients(): () => void {
    const client = useQueryClient();
    return useCallback(() => void client.invalidateQueries({ queryKey: [PATIENTS_KEY] }), [client]);
}
