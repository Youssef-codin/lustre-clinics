// What this cluster does with money that is its own — the entry rules, the
// ceiling, and the sentence the desk reads back. Formatting is
// `components/domain/money`, which §7.12 makes the one implementation; this
// file held a second one until the shared one grew to cover it.
import { PIASTRES_PER_POUND } from '@lustre/shared';
import { formatMoney, toPounds } from '../../../components/domain/money';

export { formatMoney, toPounds };

/**
 * The payment field takes digits and nothing else. `ui/NumericField` is asked
 * for `number-pad` so there is no decimal key to press, and this refuses a
 * paste: `12.50` read as `1250` is a hundredfold overcharge, and the money is
 * integer piastres end to end (§7.12) with piastres never entered.
 */
export function isWholePounds(text: string): boolean {
    return /^[0-9]*$/.test(text);
}

/**
 * Pounds typed into the field, as the piastres to send.
 *
 * The ceiling is not a courtesy any more. `balance.settle` **refuses** anything
 * over what the patient owes, and `toPounds` rounds to the nearer pound: an
 * outstanding of 120.50 shows a due of 121, and submitting 12,100 piastres
 * against a 12,050 balance would come back refused for a figure the screen
 * itself displayed. Clamping to the real balance is what keeps the entry and
 * the server agreeing about the last fifty piastres.
 */
export function clampToOutstanding(enteredPounds: number, outstanding: number): number {
    if (!Number.isFinite(enteredPounds) || enteredPounds <= 0) return 0;
    return Math.max(0, Math.min(Math.trunc(enteredPounds) * PIASTRES_PER_POUND, outstanding));
}

const METHOD_LABEL: Record<string, string> = {
    cash: 'Cash',
    // What the desk calls it. The stored value is untouched.
    visa: 'Card',
    instapay: 'Instapay',
    other: 'Other',
};

export function methodLabel(method: string): string {
    return METHOD_LABEL[method] ?? 'Other';
}

/**
 * What the payment did, in the terms the desk posts it in: `EGP 6,000 recorded
 * — EGP 3,550 still owed`.
 *
 * The clinic's paper book is one page per patient, so the desk writes one line
 * against one page: what came in, and what is left. That is the whole sentence.
 *
 * It named the individual visits until the paper was understood — *"settled
 * 060826-5NCC, part-paid 120826-57UQ"* — on the assumption that the file was per
 * visit and the ref matched the two. It is not, so those refs pointed at pages
 * that do not exist. The server still returns the per-visit split and should
 * keep doing so; it is bookkeeping, not something anyone copies out.
 *
 * Paying a balance off in full is worth saying outright rather than as `EGP 0
 * still owed` — the desk marks the page closed, which is a different pen stroke.
 */
export function paymentReceipt(report: { amount: number; outstandingAfter: number }): string {
    const taken = `${formatMoney(report.amount)} recorded`;

    return report.outstandingAfter <= 0
        ? `${taken} — paid in full`
        : `${taken} — ${formatMoney(report.outstandingAfter)} still owed`;
}
