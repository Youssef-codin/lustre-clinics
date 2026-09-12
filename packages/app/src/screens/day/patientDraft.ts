/**
 * Who a booking is for, as the desk answers it: someone on file, or someone who
 * is not yet. The draft lives here rather than in `PatientPicker` because it
 * outlives the sheet that fills it — `BookingScreen` is still reading it long
 * after the picker unmounted — and because none of it is React, so all of it can
 * be tested without a renderer.
 *
 * A new patient owes a name and a number and nothing else (PRODUCT: booking must
 * beat the paper book). The rest of the record is offered because a secretary
 * who has the card in her hand should not have to open the record afterwards to
 * type what she is already reading — but every one of those fields is optional,
 * and a blank one is stored as `null`, never as an empty string.
 *
 * What is left here is this screen's shape and its submission: the field-level
 * rules — the date of birth parse, the email check, the sexes, blank-means-null
 * — are `domain/patientDraft`, because the patient record and the bulk migration
 * hold the same draft and had grown their own copies of every one of them.
 */
import {
    birthDateError,
    birthDateIso,
    emailError,
    orNull,
    phoneError,
} from '../../components/domain/patientDraft';
import type { Patient, PatientRef } from './data';

export {
    birthDateDigits,
    birthDateDisplay,
    birthDateError,
    birthDateIso,
    emailError,
} from '../../components/domain/patientDraft';

export type PatientDraft = {
    mode: 'existing' | 'new';
    term: string;
    picked: Patient | null;
    name: string;
    phone: string;
    email: string;
    /** Digits only, `DDMMYYYY` — never the display string, which is drawn from it. */
    birthDate: string;
    gender: string;
    notes: string;
};

export const EMPTY_PATIENT_DRAFT: PatientDraft = {
    mode: 'existing',
    term: '',
    picked: null,
    name: '',
    phone: '',
    email: '',
    birthDate: '',
    gender: '',
    notes: '',
};

/**
 * What the mutation takes, or null while the draft cannot be booked. Only the
 * name and the number can hold a booking back; a detail that is half-typed does
 * too, because sending it as blank would silently throw away what the secretary
 * was in the middle of writing.
 */
export function patientRefOf(draft: PatientDraft): PatientRef | null {
    if (draft.mode === 'existing') {
        return draft.picked ? { kind: 'existing', patientId: draft.picked.id } : null;
    }

    const name = draft.name.trim();
    const phone = draft.phone.trim();
    if (name.length === 0 || phone.length === 0 || phoneError(phone) !== null) return null;
    if (emailError(draft.email) !== null || birthDateError(draft.birthDate) !== null) return null;

    return {
        kind: 'new',
        name,
        phone,
        email: orNull(draft.email),
        birthDate: birthDateIso(draft.birthDate),
        gender: orNull(draft.gender),
        notes: orNull(draft.notes),
    };
}

/** What the booking page calls them — a new patient is named before they have an id. */
export function patientNameOf(draft: PatientDraft): string {
    return draft.mode === 'existing' ? (draft.picked?.name ?? '') : draft.name.trim();
}

export function patientPhoneOf(draft: PatientDraft): string {
    return draft.mode === 'existing' ? (draft.picked?.phone ?? '') : draft.phone.trim();
}

/** The way in for a screen that already knows the patient — the record's Book. */
export function draftFor(patient: Patient): PatientDraft {
    return { ...EMPTY_PATIENT_DRAFT, picked: patient };
}
