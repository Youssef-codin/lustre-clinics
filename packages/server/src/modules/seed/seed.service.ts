/**
 * Today's live queue, built the way the desk builds it.
 *
 * Every bug the day view has thrown this week came from the same place: the
 * seed writing rows straight into the database and inventing a state the clinic
 * cannot reach. A check-in stamped for later today, so the chair's bar could
 * never start. A visit with no `in_chair_at`, so it measured the wrong thing. A
 * checked-in patient whose visit had no procedures under a booking that plainly
 * planned one — because `checkIn` copies the plan and a hand-written `INSERT`
 * does not. None of the three was an app bug and all three were reported as
 * one.
 *
 * So the states that mean "right now" — in the chair, at the desk, waiting —
 * are not written any more. They are *reached*, by calling the same services
 * the app calls, in the order a morning actually happens: everyone arrives
 * through `visitService.checkIn`, and the one who is finished leaves through
 * `appointmentService.awaitPayment`. Whatever those two do, the seed gets. When
 * they change, the seed changes with them, which is the entire point.
 *
 * What the services cannot do is happen in the past — `checkIn` stamps the
 * arrival `now` and `awaitPayment` stamps the departure `now`, so a queue built
 * this way is a queue where everybody walked in at the same instant and nobody
 * has waited. `backdate` is the second half: once the shape is right, the
 * stamps are moved to spread the morning out. Moving a timestamp cannot invent
 * an unreachable state, which is exactly why this is the safe half to fake.
 *
 * Not exported through any router. This is reachable from `scripts/seed.ts` and
 * nowhere else.
 */
import type { Tooth } from '@lustre/shared';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { appointments, visits } from '../../db/schema.ts';
import { appointmentService } from '../appointment/appointment.service.ts';
import { visitService } from '../visit/visit.service.ts';

/** How far a patient has got by the time the seed finishes. */
type Reach = 'waiting' | 'chair' | 'desk';

interface LiveArrival {
    patientId: string;
    branchId: string;
    startsAt: Date;
    durationMinutes: number;
    procedures: { procedureId: string; quantity?: number; tooth?: Tooth; note?: string }[];
    /**
     * Minutes before the seed runs that this patient came through the door.
     * Order matters and is the order of the array: the queue is built by
     * arriving, so whoever is listed first is whoever walked in first.
     */
    arrivedAgo: number;
    /** Minutes before the seed runs that they reached the chair, if they have. */
    seatedAgo?: number;
    reach: Reach;
    channel?: 'desk' | 'walk_in';
    note?: string;
}

interface LiveSeatResult {
    appointmentId: string;
    visitId: string;
}

function minutesAgo(minutes: number): Date {
    return new Date(Math.floor(Date.now() / 60_000) * 60_000 - minutes * 60_000);
}

export const seedService = {
    /**
     * Walk the arrivals through check-in, then send the finished one to the
     * desk. The promotion falls out of that last step rather than being
     * arranged here: `awaitPayment` seats the longest wait, so listing the
     * patients in arrival order is the whole of the setup.
     */
    async liveDay(arrivals: readonly LiveArrival[]): Promise<LiveSeatResult[]> {
        const seated: LiveSeatResult[] = [];

        for (const arrival of arrivals) {
            const procedures = arrival.procedures.map((line) => ({
                procedureId: line.procedureId,
                quantity: line.quantity ?? 1,
                tooth: line.tooth ?? null,
                note: line.note ?? null,
            }));

            // A walk-in is a different door, not a flag on this one. `walkIn`
            // marks the channel, books the patient at the moment they arrived —
            // or at the end of whatever is in the chair — and cascades anything
            // it displaces. Going through `create` instead produced a walk-in
            // recorded as a desk booking at a time somebody had to invent.
            if (arrival.channel === 'walk_in') {
                const result = await appointmentService.walkIn({
                    patient: { kind: 'existing', patientId: arrival.patientId },
                    branchId: arrival.branchId,
                    durationMinutes: arrival.durationMinutes,
                    procedures,
                    note: arrival.note ?? null,
                    offsetMinutes: 0,
                });
                seated.push({ appointmentId: result.appointment.id, visitId: result.visitId });
                continue;
            }

            const appointment = await appointmentService.create({
                patient: { kind: 'existing', patientId: arrival.patientId },
                branchId: arrival.branchId,
                startsAt: arrival.startsAt.toISOString(),
                durationMinutes: arrival.durationMinutes,
                procedures,
                note: arrival.note ?? null,
                offsetMinutes: 0,
            });

            const visit = await visitService.checkIn({ appointmentId: appointment.id });
            seated.push({ appointmentId: appointment.id, visitId: visit.id });
        }

        // Second pass, not woven into the first: the desk sends a patient on
        // only once the next one is already standing there, and doing it in one
        // loop would empty the chair before anybody had arrived to take it.
        for (const [index, arrival] of arrivals.entries()) {
            if (arrival.reach !== 'desk') continue;
            const row = seated[index];
            if (row) await appointmentService.awaitPayment(row.appointmentId);
        }

        await backdate(arrivals, seated);
        return seated;
    },
};

/**
 * Spread the morning out.
 *
 * The services stamped everything with the moment the seed ran, which is a true
 * record of a queue nobody waited in. Only the clocks move here — who is in the
 * chair, whose visit carries which procedures, which appointment is
 * `awaiting_payment`, all of that was decided by the services and is left
 * alone.
 *
 * `updated_at` moves with the status change it represents, because the day view
 * falls back to it when a visit is not to hand and would otherwise order the
 * queue by the instant the seed ran.
 */
async function backdate(arrivals: readonly LiveArrival[], seated: readonly LiveSeatResult[]): Promise<void> {
    for (const [index, arrival] of arrivals.entries()) {
        const row = seated[index];
        if (!row) continue;

        const arrivedAt = minutesAgo(arrival.arrivedAgo);
        // A patient still waiting has no seating time, and must not be given
        // one — that null is what the chair's bar reads to know they have not
        // started.
        const seatedAt = arrival.seatedAgo === undefined ? null : minutesAgo(arrival.seatedAgo);

        await db
            .update(visits)
            .set({ checkedInAt: arrivedAt, ...(seatedAt ? { inChairAt: seatedAt } : {}) })
            .where(eq(visits.id, row.visitId));

        await db
            .update(appointments)
            .set({ updatedAt: seatedAt ?? arrivedAt })
            .where(eq(appointments.id, row.appointmentId));
    }
}
