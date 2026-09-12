/**
 * SPEC §8, §9. A visit is what happened, as opposed to what was scheduled.
 *
 * Check-in creates it and seeds its lines: one per procedure the booking
 * planned (§7), each priced at the catalogue price on the day rather than at
 * booking, plus the checkup line — skipped when the plan already names a
 * checkup, or the visit would open with two. Pricing is not a prerequisite for
 * checkout: `setProcedures` and `setPrice` are optional, may be called in any
 * order, and procedure detail is often entered after the patient has left.
 *
 * The §5 rules the lines obey — selectable leaf, tooth required or not
 * applicable, quantity, uniqueness per tooth — live in `procedure.rules.ts`,
 * shared with booking so the two cannot drift. The charged total tracks the
 * computed one until someone edits it, and `priced_at` records that they did;
 * both are frozen at checkout, when the balance the patient owes is settled.
 * Checkout closes either `checked_in` (the chair) or `awaiting_payment` (the
 * desk), and zero paid is a valid checkout — the balance is derived (§10).
 */
import { canTransition, ERROR_CODE, type Tooth, WS_EVENT } from '@lustre/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db, type Executor } from '../../db/index.ts';
import {
    appointmentProcedures,
    appointments,
    payments,
    procedureTypes,
    visitProcedures,
    visits,
} from '../../db/schema.ts';
import { AppError, PG_ERROR, pgErrorCode } from '../../errors/AppError.ts';
import { computeTotal } from '../../util/money.ts';
import { broadcast } from '../../ws/index.ts';
import { resolveProcedureLines } from '../procedure/procedure.rules.ts';
import { procedureService } from '../procedure/procedure.service.ts';
import type {
    CheckInInput,
    CheckOutInput,
    RecordPaymentInput,
    ReopenInput,
    SetPaidInput,
    SetPriceInput,
    SetProceduresInput,
} from './visit.schema.ts';

type VisitRow = typeof visits.$inferSelect;

interface VisitLine {
    id: string;
    procedureId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    isCheckup: boolean;
    tooth: Tooth | null;
    note: string | null;
    lineTotal: number;
}

interface VisitPayment {
    id: string;
    amount: number;
    method: string;
    methodNote: string | null;
    paidAt: Date;
}

interface Visit extends VisitRow {
    procedures: VisitLine[];
    payments: VisitPayment[];
    paidTotal: number;
    balance: number;
}

async function requireVisit(executor: Executor, id: string): Promise<VisitRow> {
    const [row] = await executor.select().from(visits).where(eq(visits.id, id)).limit(1);
    if (!row) throw AppError.notFound('visit');
    return row;
}

async function recompute(executor: Executor, visitId: string): Promise<number> {
    const lines = await executor
        .select({
            unitPrice: visitProcedures.unitPrice,
            quantity: visitProcedures.quantity,
            isCheckup: procedureTypes.isCheckup,
        })
        .from(visitProcedures)
        .innerJoin(procedureTypes, eq(visitProcedures.procedureId, procedureTypes.id))
        .where(eq(visitProcedures.visitId, visitId));

    const computedTotal = computeTotal(lines);
    await executor.update(visits).set({ computedTotal }).where(eq(visits.id, visitId));
    return computedTotal;
}

/**
 * Whoever is in the chair at this branch right now, if anyone.
 *
 * "In the chair" is a stamp, not a position in a queue: `in_chair_at` set and
 * the appointment still `checked_in`. Once they go to the desk or are checked
 * out the status moves on and the chair reads empty again, which is what makes
 * this safe to ask before seating someone.
 */
async function chairIsTaken(tx: Executor, branchId: string): Promise<boolean> {
    const [seated] = await tx
        .select({ id: visits.id })
        .from(visits)
        .innerJoin(appointments, eq(appointments.id, visits.appointmentId))
        .where(
            and(
                eq(appointments.branchId, branchId),
                eq(appointments.status, 'checked_in'),
                sql`${visits.inChairAt} is not null`,
            ),
        )
        .limit(1);

    return seated !== undefined;
}

/**
 * Move the longest-waiting patient into the chair the moment it empties.
 *
 * Called from both ways out of the chair — to the desk (`awaitPayment`) and
 * straight to checkout — because the patient who has been waiting since 08:24
 * did not begin their visit when they arrived, they began it when the person
 * ahead of them got up. That is the whole reason `in_chair_at` exists: the bar
 * on the day view measures from here, and measuring from `checked_in_at`
 * charged the second patient of the morning with the first one's visit.
 *
 * Longest wait wins, which is the same order the day view queues people in, so
 * the screen and the stamp cannot name different patients. Nobody waiting is
 * the ordinary case and does nothing — the next arrival seats themselves.
 */
export async function seatNextInChair(tx: Executor, branchId: string, now: Date): Promise<void> {
    const [next] = await tx
        .select({ visitId: visits.id })
        .from(visits)
        .innerJoin(appointments, eq(appointments.id, visits.appointmentId))
        .where(
            and(
                eq(appointments.branchId, branchId),
                eq(appointments.status, 'checked_in'),
                isNull(visits.inChairAt),
            ),
        )
        .orderBy(asc(visits.checkedInAt))
        .limit(1);

    if (!next) return;

    await tx.update(visits).set({ inChairAt: now }).where(eq(visits.id, next.visitId));
}

export const visitService = {
    async checkIn(input: CheckInInput, executor?: Executor): Promise<VisitRow> {
        const run = async (tx: Executor): Promise<VisitRow> => {
            const [appointment] = await tx
                .select()
                .from(appointments)
                .where(eq(appointments.id, input.appointmentId))
                .limit(1);

            if (!appointment) throw AppError.notFound('appointment');

            if (!canTransition(appointment.status, 'checked_in')) {
                throw new AppError(
                    ERROR_CODE.INVALID_STATUS_TRANSITION,
                    `cannot check in an appointment that is ${appointment.status}`,
                    422,
                );
            }

            const now = new Date();

            // Walking into an empty chair is the common case at a quiet clinic,
            // and it is the one where arriving and being seated are the same
            // moment. With someone already in it this patient is queueing, and
            // `in_chair_at` stays null until they get up.
            const waiting = await chairIsTaken(tx, appointment.branchId);

            let visit: VisitRow | undefined;
            try {
                [visit] = await tx
                    .insert(visits)
                    .values({
                        id: Bun.randomUUIDv7(),
                        appointmentId: appointment.id,
                        checkedInAt: now,
                        inChairAt: waiting ? null : now,
                    })
                    .returning();
            } catch (err) {
                if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) {
                    throw new AppError(
                        ERROR_CODE.VISIT_ALREADY_EXISTS,
                        'this appointment already has a visit',
                        409,
                        { cause: err },
                    );
                }
                throw err;
            }

            if (!visit) throw AppError.internal('visit insert returned nothing');

            await tx
                .update(appointments)
                .set({ status: 'checked_in', updatedAt: now })
                .where(eq(appointments.id, appointment.id));

            const planned = await tx
                .select({
                    procedureId: appointmentProcedures.procedureId,
                    quantity: appointmentProcedures.quantity,
                    tooth: appointmentProcedures.tooth,
                    note: appointmentProcedures.note,
                    defaultPrice: procedureTypes.defaultPrice,
                    isCheckup: procedureTypes.isCheckup,
                })
                .from(appointmentProcedures)
                .innerJoin(procedureTypes, eq(appointmentProcedures.procedureId, procedureTypes.id))
                .where(eq(appointmentProcedures.appointmentId, appointment.id))
                .orderBy(asc(appointmentProcedures.sortOrder));

            if (planned.length > 0) {
                await tx.insert(visitProcedures).values(
                    planned.map((line) => ({
                        id: Bun.randomUUIDv7(),
                        visitId: visit.id,
                        procedureId: line.procedureId,
                        quantity: line.quantity,
                        unitPrice: line.defaultPrice,
                        tooth: line.tooth,
                        note: line.note,
                    })),
                );
            }

            const checkup = planned.some((line) => line.isCheckup)
                ? null
                : await procedureService.findCheckup();
            if (checkup) {
                await tx.insert(visitProcedures).values({
                    id: Bun.randomUUIDv7(),
                    visitId: visit.id,
                    procedureId: checkup.id,
                    quantity: 1,
                    unitPrice: checkup.defaultPrice,
                });
            }

            const computedTotal = await recompute(tx, visit.id);
            const [priced] = await tx
                .update(visits)
                .set({ chargedTotal: computedTotal })
                .where(eq(visits.id, visit.id))
                .returning();

            return priced ?? visit;
        };

        const visit = executor ? await run(executor) : await db.transaction(run);

        broadcast(WS_EVENT.VISIT_UPDATED, { id: visit.id });
        broadcast(WS_EVENT.APPOINTMENT_UPDATED, { id: visit.appointmentId });
        return visit;
    },

    async byId(id: string): Promise<Visit> {
        const visit = await requireVisit(db, id);

        const lines = await db
            .select({
                id: visitProcedures.id,
                procedureId: visitProcedures.procedureId,
                name: procedureTypes.name,
                quantity: visitProcedures.quantity,
                unitPrice: visitProcedures.unitPrice,
                isCheckup: procedureTypes.isCheckup,
                tooth: visitProcedures.tooth,
                note: visitProcedures.note,
            })
            .from(visitProcedures)
            .innerJoin(procedureTypes, eq(visitProcedures.procedureId, procedureTypes.id))
            .where(eq(visitProcedures.visitId, id));

        const paymentRows = await db
            .select({
                id: payments.id,
                amount: payments.amount,
                method: payments.method,
                methodNote: payments.methodNote,
                paidAt: payments.paidAt,
            })
            .from(payments)
            .where(eq(payments.visitId, id));

        const paidTotal = paymentRows.reduce((sum, p) => sum + p.amount, 0);

        return {
            ...visit,
            procedures: lines.map((l) => ({ ...l, lineTotal: l.unitPrice * l.quantity })),
            payments: paymentRows,
            paidTotal,
            balance: visit.chargedTotal - paidTotal,
        };
    },

    async setProcedures(input: SetProceduresInput): Promise<Visit> {
        const lines = await resolveProcedureLines(input.procedures);

        const resolved = lines.map((line, i) => ({
            procedureId: line.procedure.id,
            quantity: line.quantity,
            unitPrice: input.procedures[i]?.unitPrice ?? line.procedure.defaultPrice,
            tooth: line.tooth,
            note: line.note,
        }));

        await db.transaction(async (tx) => {
            const visit = await requireVisit(tx, input.visitId);
            if (visit.completedAt) {
                throw new AppError(
                    ERROR_CODE.VISIT_ALREADY_COMPLETED,
                    'this visit is already checked out',
                    409,
                );
            }

            await tx.delete(visitProcedures).where(eq(visitProcedures.visitId, visit.id));

            if (resolved.length > 0) {
                await tx.insert(visitProcedures).values(
                    resolved.map((line) => ({
                        id: Bun.randomUUIDv7(),
                        visitId: visit.id,
                        ...line,
                    })),
                );
            }

            const computedTotal = await recompute(tx, visit.id);

            if (!visit.pricedAt) {
                await tx.update(visits).set({ chargedTotal: computedTotal }).where(eq(visits.id, visit.id));
            }
        });

        broadcast(WS_EVENT.VISIT_UPDATED, { id: input.visitId });
        return this.byId(input.visitId);
    },

    async setPrice(input: SetPriceInput): Promise<Visit> {
        const row = await db.transaction(async (tx) => {
            const visit = await requireVisit(tx, input.visitId);

            if (visit.completedAt) {
                throw new AppError(
                    ERROR_CODE.VISIT_ALREADY_COMPLETED,
                    'this visit is already checked out',
                    409,
                );
            }

            const [updated] = await tx
                .update(visits)
                .set({ chargedTotal: input.chargedTotal, pricedAt: new Date() })
                .where(eq(visits.id, visit.id))
                .returning();

            if (!updated) throw AppError.notFound('visit');
            return updated;
        });

        broadcast(WS_EVENT.VISIT_UPDATED, { id: row.id });
        return this.byId(row.id);
    },

    async checkOut(input: CheckOutInput): Promise<Visit> {
        await db.transaction(async (tx) => {
            const visit = await requireVisit(tx, input.visitId);

            if (visit.completedAt) {
                throw new AppError(
                    ERROR_CODE.VISIT_ALREADY_COMPLETED,
                    'this visit is already checked out',
                    409,
                );
            }

            const [appointment] = await tx
                .select()
                .from(appointments)
                .where(eq(appointments.id, visit.appointmentId))
                .limit(1);

            if (!appointment) throw AppError.notFound('appointment');

            // Closing a visit that was reopened to be corrected: the
            // appointment never left `done` (see `reopen`), so there is no
            // transition to make and none to check. The guard above is what
            // stops this being a double checkout — a visit that is still
            // closed is refused before we get here.
            const reclosing = appointment.status === 'done';

            if (!reclosing && !canTransition(appointment.status, 'done')) {
                throw new AppError(
                    ERROR_CODE.INVALID_STATUS_TRANSITION,
                    `cannot check out an appointment that is ${appointment.status}`,
                    422,
                );
            }

            const now = new Date();

            await tx
                .update(visits)
                .set({
                    chargedTotal: input.chargedTotal,
                    pricedAt: visit.pricedAt ?? now,
                    completedAt: now,
                })
                .where(eq(visits.id, visit.id));

            if (input.paidTotal > 0) {
                await insertPayment(tx, visit.id, input.paidTotal, input.method, input.methodNote ?? null);
            }

            if (!reclosing) {
                await tx
                    .update(appointments)
                    .set({ status: 'done', updatedAt: now })
                    .where(eq(appointments.id, appointment.id));

                // Checking out straight from the chair empties it. Reclosing a
                // corrected visit does not — that patient left long ago, and
                // seating someone off it would restart a bar that is already
                // running.
                if (appointment.status === 'checked_in') {
                    await seatNextInChair(tx, appointment.branchId, now);
                }
            }
        });

        broadcast(WS_EVENT.VISIT_UPDATED, { id: input.visitId });
        return this.byId(input.visitId);
    },

    /**
     * Correct what a visit was paid, in total — the only way a recorded payment
     * comes back down. `800 collected` on a visit that took 500 is corrected by
     * saying 500, not by asking for a refund of 300.
     *
     * What is written is the difference, as a payment row of its own: a refund
     * is a negative payment, dated the day the correction was made. Nothing is
     * edited and nothing is deleted, because the 800 row is still a true record
     * of what was entered at the time, and the readers all sum the column
     * (`stats`, `balance`), so the money lands in the right place on its own.
     *
     * Saying what is already on the visit writes nothing at all.
     */
    async setPaid(input: SetPaidInput): Promise<Visit> {
        await db.transaction(async (tx) => {
            const visit = await requireVisit(tx, input.visitId);

            const [collected] = await tx
                .select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int` })
                .from(payments)
                .where(eq(payments.visitId, visit.id));

            const delta = input.paidTotal - (collected?.total ?? 0);
            if (delta === 0) return;

            await insertPayment(tx, visit.id, delta, input.method, input.methodNote ?? null);
        });

        broadcast(WS_EVENT.VISIT_UPDATED, { id: input.visitId });
        return this.byId(input.visitId);
    },

    async recordPayment(input: RecordPaymentInput): Promise<Visit> {
        await db.transaction(async (tx) => {
            const visit = await requireVisit(tx, input.visitId);
            await insertPayment(tx, visit.id, input.amount, input.method, input.methodNote ?? null);
        });

        broadcast(WS_EVENT.VISIT_UPDATED, { id: input.visitId });
        return this.byId(input.visitId);
    },

    /**
     * Unlock a finished visit so it can be corrected — the wrong tooth charged,
     * a procedure left off.
     *
     * The *appointment* is not touched. It stays `done`, because it is: the
     * patient came, was seen and went home, and someone fixing the paperwork
     * three weeks later does not undo that. Moving it back to
     * `awaiting_payment` — which is what this did — put the patient back on the
     * day view as though they were standing at the desk waiting to pay, and an
     * edit that was opened and backed out of left them there for good.
     *
     * So `completedAt` on the visit is the only thing that says "closed", and
     * clearing it is the whole of reopening. `pricedAt` goes with it: checkout
     * stamps it, and leaving it set would pin `chargedTotal` while
     * `setProcedures` recomputed around it — the lines would change and the
     * bill would not.
     *
     * Payments already taken are untouched. The money was handed over and the
     * receipt is a fact; the visit reopens owing whatever is left after them,
     * which is what `amountDue` already reads.
     */
    async reopen(input: ReopenInput): Promise<Visit> {
        await db.transaction(async (tx) => {
            const visit = await requireVisit(tx, input.visitId);

            if (!visit.completedAt) {
                throw new AppError(
                    ERROR_CODE.INVALID_STATUS_TRANSITION,
                    'this visit is not checked out',
                    422,
                );
            }

            await tx.update(visits).set({ completedAt: null, pricedAt: null }).where(eq(visits.id, visit.id));
        });

        broadcast(WS_EVENT.VISIT_UPDATED, { id: input.visitId });
        return this.byId(input.visitId);
    },

    async byAppointment(appointmentId: string): Promise<VisitRow | null> {
        const [row] = await db.select().from(visits).where(eq(visits.appointmentId, appointmentId)).limit(1);
        return row ?? null;
    },
};

/**
 * The one place a `payments` row is written. Exported because `balance.settle`
 * allocates a patient-level payment across several visits and each slice is an
 * ordinary payment row — sharing this is what keeps the two check-violation
 * cases mapping to the same `ERROR_CODE` from both entry points.
 */
export async function insertPayment(
    executor: Executor,
    visitId: string,
    amount: number,
    method: RecordPaymentInput['method'],
    methodNote: string | null,
): Promise<void> {
    try {
        await executor.insert(payments).values({
            id: Bun.randomUUIDv7(),
            visitId,
            amount,
            method,
            methodNote,
        });
    } catch (err) {
        if (pgErrorCode(err) === PG_ERROR.CHECK_VIOLATION) {
            throw method === 'other'
                ? new AppError(ERROR_CODE.PAYMENT_NOTE_REQUIRED, "method 'other' requires a note", 422, {
                      cause: err,
                  })
                : new AppError(ERROR_CODE.INVALID_AMOUNT, 'payment amount is out of range', 422, {
                      cause: err,
                  });
        }
        throw err;
    }
}
