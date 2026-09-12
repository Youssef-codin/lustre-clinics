/**
 * SPEC §5 — two refs, one alphabet.
 *
 * `appointments.ref` is `DDMMYY-XXXX`, day first, unique within the date.
 * `patients.ref` is `XXXX` alone: a patient is not an event, and the number goes
 * at the top of a page in the paper book rather than against a day.
 *
 * The alphabet excludes `0/O` and `1/I/L` so a ref read down the phone or
 * written by hand is unambiguous. Stored uppercase, matched case-insensitively.
 *
 * Modulo bias across the alphabet's symbols is irrelevant: uniqueness is
 * enforced by the UNIQUE constraint, not by the distribution.
 */
import { REF_ALPHABET, REF_RANDOM_LENGTH } from '@lustre/shared';
import { refDatePart } from './time.ts';

function randomRefSuffix(): string {
    const bytes = new Uint8Array(REF_RANDOM_LENGTH);
    crypto.getRandomValues(bytes);

    let out = '';
    for (const byte of bytes) {
        out += REF_ALPHABET[byte % REF_ALPHABET.length];
    }
    return out;
}

export function buildRef(startsAt: Date, offsetMinutes = 0): string {
    return `${refDatePart(startsAt, offsetMinutes)}-${randomRefSuffix()}`;
}

/**
 * A patient's ref: the random part with no date on the front. Named rather than
 * having callers reach for `randomRefSuffix`, because this one is an identifier
 * in its own right and not a suffix of anything.
 */
export function buildPatientRef(): string {
    return randomRefSuffix();
}
