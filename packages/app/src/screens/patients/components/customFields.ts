// The one place this cluster knows anything about answer types. Custom
// questions are dentist-defined; nothing about any clinic's questionnaire is
// written down here, so a question is only ever a kind, a label and a key.
// `date` is deliberately not in `EDITABLE_KINDS` (§7.9): the server stores it,
// the record displays it read-only, and it never disappears or crashes a
// record. Adding it later is putting `'date'` in `EDITABLE_KINDS` and returning
// a control from its case. `''` is a cleared answer, which the server deletes
// from `patients.custom` rather than storing blank.
//
// There is no per-answer validation here, deliberately. What the editor refuses
// it refuses in `patientForm.ts`, against the server's own two rules
// (`validateIntake` on the whole form, `validatePatch` on the keys it is sent).
// A third opinion held locally would be the one that goes stale: an option
// dropped from a `select` in 2026 must **not** stop the desk correcting an
// answer given under it in 2024, which is the whole reason a record can outlive
// its questionnaire (§7.8).
//
// A draft is a **string for every kind, including boolean**, because a boolean
// question has three states and not two: yes, no, and never asked.
// `patient-edit.html` draws exactly that — the Yes/No pair with neither half
// filled — and the record's `questionnaireGaps` counts an absent key as a gap,
// so a draft that could only be `true | false` would answer "no" on the
// patient's behalf the moment the editor opened. `YES`/`NO` are the two
// non-empty values; `''` is the third.
import type { CustomQuestion, QuestionKind } from '../data/types';

const EDITABLE_KINDS = ['text', 'number', 'boolean', 'select'] as const;

export type EditableKind = (typeof EDITABLE_KINDS)[number];

export function isEditable(question: CustomQuestion): question is CustomQuestion & { kind: EditableKind } {
    return (EDITABLE_KINDS as readonly QuestionKind[]).includes(question.kind);
}

export const YES = 'true';
export const NO = 'false';

export type DraftValue = string;

export type Draft = Record<string, DraftValue>;

export function toDraft(question: CustomQuestion, stored: unknown): DraftValue {
    if (question.kind === 'boolean') {
        if (stored === true) return YES;
        if (stored === false) return NO;
        return '';
    }
    if (stored === undefined || stored === null) return '';
    return String(stored);
}

export function fromDraft(question: CustomQuestion, draft: DraftValue): unknown {
    const trimmed = draft.trim();
    if (trimmed === '') return '';

    if (question.kind === 'boolean') return trimmed === YES;
    if (question.kind === 'number') {
        const n = Number(trimmed);
        return Number.isFinite(n) ? n : trimmed;
    }
    return trimmed;
}

/** Whether the desk has given this question an answer — what the editor's progress bar counts. */
export function isAnswered(draft: DraftValue): boolean {
    return draft.trim() !== '';
}

export function displayAnswer(question: CustomQuestion, stored: unknown): string | null {
    if (stored === undefined || stored === null || stored === '') return null;

    switch (question.kind) {
        case 'boolean':
            return stored === true ? 'Yes' : 'No';
        case 'number':
        case 'text':
        case 'select':
        case 'date':
            return String(stored);
    }
}

export function isReadOnly(question: CustomQuestion): boolean {
    return !isEditable(question);
}
