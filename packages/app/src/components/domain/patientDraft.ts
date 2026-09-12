/**
 * The field-level rules for a patient somebody is typing — a name, a number, an
 * email, an age or a date of birth, a sex. Three screens hold that draft and
 * each held its own copy of these: the booking's first step, the patient record,
 * and the bulk migration. None of it is React, so all of it is tested without a
 * renderer.
 *
 * What lives here is the rules. What does **not** is the submission shape: each
 * cluster keeps its own, because `patient.create`, `patient.update` and
 * `migration.enter` genuinely take three different things and an edit sends only
 * what moved.
 *
 * ## Age is stored as a date of birth
 *
 * This is the app's one lossy conversion, and the reason a third copy of it was
 * worth stopping. The design's basics row asks for a whole-number age; the
 * server has no age column — `patients.birth_date` is the fact and `age` is
 * derived from it at read time — so 34 is written as `1 January (this year −
 * 34)`, which reads back as 34 for the rest of this year and 35 next year. The
 * patient does age, which is the point. What is lost is the day they age *on*,
 * which a clinic that only ever asked "how old are you?" never knew either.
 *
 * The lossy half is guarded rather than accepted, and the guard is the callers':
 * `birthDate` is only sent when the age string on screen differs from the age
 * the record arrived with, so a patient booked in with a real date off an ID
 * card is never flattened to 1 January by an editor opened to fix their phone
 * number. That comparison is on the age *string*, not on the date it derives to.
 *
 * Where the desk types the date itself — the booking, which asks for it — no
 * conversion happens at all and `birthDateIso` takes the digits straight.
 *
 * Every check here is the client's courtesy, not the authority: the server
 * validates the same fields and would refuse a bad one anyway. They exist so a
 * typo is caught while the patient is still on the phone.
 */
import { daysInMonth, todayKey } from '@lustre/shared';

/** Stored lowercase, the way every record already on file spells it. */
export const FEMALE = 'female';
export const MALE = 'male';

/** The design's toggle, with `''` as the way back out of a mis-tap. */
export const GENDERS: readonly { value: string; label: string }[] = [
    { value: '', label: 'Not recorded' },
    { value: FEMALE, label: 'Female' },
    { value: MALE, label: 'Male' },
];

/** Deliberately loose. The server's is stricter; this one only catches the obvious. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The server refuses under 5 too. Short enough to be a mis-tap rather than a number. */
const SHORTEST_PHONE = 5;

/** Nobody has been alive longer than this, and a typo like `340` should not reach the server. */
const OLDEST_AGE = 129;

/** Day, month, year — the order an ID card is read out in. */
export const BIRTH_DATE_DIGITS = 8;

const EARLIEST_BIRTH_YEAR = 1900;

/** Blank means the question was not answered, and the record says so rather than storing an empty string. */
export function orNull(value: string): string | null {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function emailError(email: string): string | null {
    const value = email.trim();
    if (value.length === 0) return null;
    return EMAIL.test(value) ? null : 'That address is missing something.';
}

/**
 * Spaces and the leading `+` do not count towards the length: `+20 101 234 5678`
 * is a real number and refusing it for having spaces in it refuses the form the
 * desk pastes it in.
 *
 * Whether the field was *answered* is judged on what was typed, and only the
 * length on what is left after stripping. Judging both on the stripped string
 * reads a lone `"+"` as an untouched field and lets it through to the server —
 * separators are not an answer, but typing one is not nothing either.
 */
export function phoneError(phone: string): string | null {
    const entered = phone.trim();
    if (entered.length === 0) return null;
    const digits = entered.replace(/[\s+]/g, '');
    return digits.length < SHORTEST_PHONE ? 'That is too short to be a number.' : null;
}

// --- the age, converted (the patient record and the migration) --------------

export function ageDigits(text: string): string {
    return text.replace(/\D/g, '').slice(0, 3);
}

/** 1 January of the year that makes the patient this old today. See the note above. */
export function birthDateOf(age: string, today: Date = new Date()): string | null {
    const years = Number(age);
    if (age.trim() === '' || !Number.isInteger(years) || years < 0 || years > OLDEST_AGE) return null;
    return `${today.getFullYear() - years}-01-01`;
}

export function ageError(age: string): string | null {
    if (age.trim() === '') return null;
    return birthDateOf(age) === null ? 'That is not an age.' : null;
}

// --- the date of birth, typed (the booking) ---------------------------------
//
// Typed, not picked: a calendar is the wrong instrument for a year forty years
// back, and the secretary is reading digits off an ID card out loud. So the
// field holds digits and nothing else and the slashes are drawn around them,
// which makes an interrupted entry (`0511`) a legible half-answer rather than
// an ambiguous date.

export function birthDateDigits(text: string): string {
    return text.replace(/\D/g, '').slice(0, BIRTH_DATE_DIGITS);
}

/** What the field shows: the digits so far, with the separators the entry has earned. */
export function birthDateDisplay(digits: string): string {
    return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)]
        .filter((part) => part.length > 0)
        .join(' / ');
}

/** `YYYY-MM-DD` for the server, or null while the entry is incomplete or impossible. */
export function birthDateIso(digits: string, today: string = todayKey()): string | null {
    if (digits.length !== BIRTH_DATE_DIGITS) return null;

    const day = Number(digits.slice(0, 2));
    const month = Number(digits.slice(2, 4));
    const year = Number(digits.slice(4, 8));

    if (month < 1 || month > 12) return null;
    if (day < 1 || day > daysInMonth(year, month)) return null;
    if (year < EARLIEST_BIRTH_YEAR) return null;

    const iso = `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
    return iso > today ? null : iso;
}

/** What to say under the field, or null while there is nothing to correct. */
export function birthDateError(digits: string, today: string = todayKey()): string | null {
    if (digits.length === 0) return null;
    if (digits.length < BIRTH_DATE_DIGITS) return 'Day, month and year — 05 / 11 / 1990.';
    return birthDateIso(digits, today) === null ? 'That is not a date anyone was born on.' : null;
}
