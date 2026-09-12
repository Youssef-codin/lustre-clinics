/**
 * Every failure this cluster can hand the UI, carrying the code it localizes
 * from — the client switches on `ERROR_CODE` and never parses the server's
 * `message`. Its own module, and importing nothing but the contract, so
 * `errors.ts` can be reached from `bun test` without dragging React Native in
 * behind the tRPC client.
 */
import type { ErrorCode } from '@lustre/shared';

export class PatientsRequestError extends Error {
    readonly code: ErrorCode;
    readonly offline: boolean;

    constructor(code: ErrorCode, message: string, options?: { offline?: boolean; cause?: unknown }) {
        super(message, { cause: options?.cause });
        this.name = 'PatientsRequestError';
        this.code = code;
        this.offline = options?.offline ?? false;
    }
}
