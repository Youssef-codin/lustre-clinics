/**
 * SPEC §6, §13 — the doctor view's numbers for a period. Everything here is an
 * aggregate over the same rows the rest of the app writes; nothing is stored
 * separately, so a stat can never drift from what happened.
 *
 * `outstanding` is the standing balance — what is still owed right now — not a
 * per-period figure.
 */
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { appointments, payments, procedureTypes, visitProcedures, visits } from '../../db/schema.ts';
import { dayRange } from '../../util/time.ts';
import { balanceService } from '../balance/balance.service.ts';
import type { StatsSummaryInput } from './stats.schema.ts';

interface StatsSummary {
    from: Date;
    to: Date;
    appointments: {
        total: number;
        completed: number;
        cancelled: number;
        noShow: number;
        walkIns: number;
        stillBooked: number;
    };
    visits: {
        total: number;
        charged: number;
        collected: number;
        outstanding: number;
    };
    topProcedures: { procedureId: string; name: string; count: number; revenue: number }[];
}

export const statsService = {
    async summary(input: StatsSummaryInput): Promise<StatsSummary> {
        const { from } = dayRange(input.from, input.offsetMinutes);
        const { to } = dayRange(input.to, input.offsetMinutes);

        // Opening-balance rows are debt the clinic inherited, not a day's work:
        // counting them would report a cutoff date on which hundreds of
        // patients were seen and a fortune was billed. `outstanding` below is
        // the one figure that does include them, because they are still owed.
        const inPeriod = and(
            gte(appointments.startsAt, from),
            lt(appointments.startsAt, to),
            eq(appointments.isOpeningBalance, false),
            ...(input.branchId ? [eq(appointments.branchId, input.branchId)] : []),
        );

        const [counts] = await db
            .select({
                total: sql<number>`COUNT(*)::int`,
                completed: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'done')::int`,
                cancelled: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'cancelled')::int`,
                noShow: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'no_show')::int`,
                walkIns: sql<number>`COUNT(*) FILTER (WHERE ${appointments.channel} = 'walk_in')::int`,
                stillBooked: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'booked')::int`,
            })
            .from(appointments)
            .where(inPeriod);

        const [visitTotals] = await db
            .select({
                total: sql<number>`COUNT(*)::int`,
                charged: sql<number>`COALESCE(SUM(${visits.chargedTotal}), 0)::int`,
            })
            .from(visits)
            .innerJoin(appointments, eq(visits.appointmentId, appointments.id))
            .where(inPeriod);

        const [collected] = await db
            .select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int` })
            .from(payments)
            .where(and(gte(payments.paidAt, from), lt(payments.paidAt, to)));

        const topProcedures = await db
            .select({
                procedureId: procedureTypes.id,
                name: procedureTypes.name,
                count: sql<number>`SUM(${visitProcedures.quantity})::int`,
                revenue: sql<number>`SUM(${visitProcedures.unitPrice} * ${visitProcedures.quantity})::int`,
            })
            .from(visitProcedures)
            .innerJoin(visits, eq(visitProcedures.visitId, visits.id))
            .innerJoin(appointments, eq(visits.appointmentId, appointments.id))
            .innerJoin(procedureTypes, eq(visitProcedures.procedureId, procedureTypes.id))
            .where(inPeriod)
            .groupBy(procedureTypes.id, procedureTypes.name)
            .orderBy(desc(sql`SUM(${visitProcedures.quantity})`))
            .limit(10);

        const { total: outstanding } = await balanceService.outstanding();

        return {
            from,
            to,
            appointments: {
                total: counts?.total ?? 0,
                completed: counts?.completed ?? 0,
                cancelled: counts?.cancelled ?? 0,
                noShow: counts?.noShow ?? 0,
                walkIns: counts?.walkIns ?? 0,
                stillBooked: counts?.stillBooked ?? 0,
            },
            visits: {
                total: visitTotals?.total ?? 0,
                charged: visitTotals?.charged ?? 0,
                collected: collected?.total ?? 0,
                outstanding,
            },
            topProcedures,
        };
    },
};
