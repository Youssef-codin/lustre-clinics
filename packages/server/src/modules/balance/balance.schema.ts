/**
 * SPEC §10. Balances are derived, never stored. Date ranges are inclusive
 * start, exclusive end — both `YYYY-MM-DD` local dates.
 */
import { MAX_AMOUNT_PIASTRES, paymentMethodSchema } from '@lustre/shared';
import { z } from 'zod';

export const byPatientInput = z.object({ patientId: z.uuid() });

/**
 * One payment against a patient, not against a visit. The service spreads it
 * over their unsettled visits oldest-first; nothing here names a visit, which
 * is the whole point — the desk knows what was handed over, not which visit it
 * belongs to.
 *
 * The ceiling is the same `MAX_AMOUNT_PIASTRES` a single `payments` row takes,
 * because each allocated slice is still an ordinary payment row. What a patient
 * actually owes is a much lower bar, and it is the service's to enforce: it is
 * the only thing that has read the balance.
 */
export const settleInput = z
    .object({
        patientId: z.uuid(),
        amount: z.number().int().min(1).max(MAX_AMOUNT_PIASTRES),
        method: paymentMethodSchema,
        methodNote: z.string().trim().max(200).nullish(),
    })
    .refine((v) => v.method !== 'other' || !!v.methodNote?.trim(), {
        message: "method 'other' requires methodNote",
        path: ['methodNote'],
    });

const offset = z.number().int().min(-840).max(840);

/**
 * A range is two local days, each expanded to an instant by the offset in force
 * *on that day*. One offset for both ends is wrong whenever the range crosses a
 * DST changeover, which "This year" does for half the year in Egypt: applied to
 * 1 January, a summer offset opens the window an hour before local midnight and
 * counts the last hour of 31 December as part of the new year. The queries
 * filter on a timestamp, not on a day bucket, so that hour really does move.
 *
 * `fromOffsetMinutes` is optional and falls back to `offsetMinutes`, which is
 * right for any range that does not span a changeover.
 */
const range = {
    from: z.iso.date(),
    to: z.iso.date(),
    offsetMinutes: offset.default(0),
    fromOffsetMinutes: offset.optional(),
};

export const balanceSummaryInput = z.object(range);

export const balanceTakingsInput = z.object(range);

export type SettleInput = z.infer<typeof settleInput>;
export type BalanceSummaryInput = z.infer<typeof balanceSummaryInput>;
export type BalanceTakingsInput = z.infer<typeof balanceTakingsInput>;
