/**
 * The old system's records are being moved across by hand — there is no export
 * and no import script, so the secretary types them in. This module is what she
 * types them into.
 *
 * It is deliberately not `patient.create`. That procedure validates the whole
 * questionnaire, because a new registration is the form answered in one
 * sitting; a migrated patient is a name and a number off a list, and their
 * answers are collected the next time they are in the chair. So the write goes
 * through `createMinimal`, the same path booking uses for the same reason.
 *
 * Nothing here refuses a duplicate. Two siblings share a mother's number, and
 * the desk is the only thing that can tell that apart from the same patient
 * typed twice — so `patient.byPhone` warns and this accepts what it is given.
 *
 * ## Opening balances
 *
 * A balance is derived and never stored — `charged_total` minus payments, per
 * visit (§10) — so debt carried over from before the cutoff has nowhere of its
 * own to live. It is given a synthetic appointment and a synthetic visit, dated
 * at the cutoff, charged with what is owed and carrying no procedures. The
 * appointment is flagged `is_opening_balance`, which is how the readers tell it
 * apart: it is owed, so `balance.outstanding` and the patient's record count
 * it, but nothing was billed and nobody sat in the chair, so `balance.summary`,
 * `stats.summary` and the day view leave it out.
 *
 * The synthetic appointment is `done` rather than `booked`. `done` does not
 * hold a slot, so four hundred of them at the same instant on the cutoff date
 * do not trip `appointments_no_overlap` — which is the only reason this fits
 * inside the existing model at all.
 *
 * Patient and balance are written in one transaction. A patient on file owing
 * nothing they actually owe is a wrong number told to them at the desk months
 * later, so if the visit cannot be written neither is the patient, and the row
 * is typed again.
 */
import { count, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { appointments, patients, visits } from '../../db/schema.ts';
import { AppError } from '../../errors/AppError.ts';
import { assertAmount } from '../../util/money.ts';
import { dayRange } from '../../util/time.ts';
import { insertWithRef } from '../appointment/appointment.service.ts';
import { branchService } from '../branch/branch.service.ts';
import type { Patient } from '../patient/patient.service.ts';
import { patientService, toPatient } from '../patient/patient.service.ts';
import type { EnterPatientInput } from './migration.schema.ts';

/** Nominal. Nobody attended and the day view never draws these, but the column is NOT NULL and checked positive. */
const SYNTHETIC_DURATION_MINUTES = 5;

/** English, for logs and for the appointment detail screen if anyone ever opens one of these. */
const SYNTHETIC_NOTE = 'Opening balance carried over from the old system';

interface EnteredPatient {
    patient: Patient;
    /** The synthetic visit carrying the opening balance, or null when the patient owed nothing. */
    openingBalanceVisitId: string | null;
}

/** How far the migration has got. The screen draws this beside its own count for the session. */
interface MigrationProgress {
    patients: number;
    openingBalances: number;
    openingBalanceTotal: number;
}

export const migrationService = {
    async enter(input: EnterPatientInput): Promise<EnteredPatient> {
        const { openingBalance, branchId, cutoffDate, offsetMinutes, ...details } = input;

        // Reference data, and the checks are about the request rather than the
        // write, so they happen before the transaction opens — the same order
        // booking uses.
        if (openingBalance !== undefined) assertAmount(openingBalance, 'opening balance');
        if (branchId !== undefined) await branchService.byId(branchId);

        return db.transaction(async (tx) => {
            const row = await patientService.createMinimal(details, tx);

            // The schema's `refine` guarantees these three travel together; the
            // narrowing is for the compiler, which cannot read it.
            if (openingBalance === undefined || branchId === undefined || cutoffDate === undefined) {
                return { patient: toPatient(row), openingBalanceVisitId: null };
            }

            const { from: at } = dayRange(cutoffDate, offsetMinutes);

            const appointment = await insertWithRef(
                tx,
                {
                    patientId: row.id,
                    branchId,
                    startsAt: at,
                    durationMinutes: SYNTHETIC_DURATION_MINUTES,
                    status: 'done',
                    isOpeningBalance: true,
                    note: SYNTHETIC_NOTE,
                },
                offsetMinutes,
            );

            const [visit] = await tx
                .insert(visits)
                .values({
                    id: Bun.randomUUIDv7(),
                    appointmentId: appointment.id,
                    checkedInAt: at,
                    // Settled from the moment it exists: there is nothing here
                    // to price, and the amount is whatever the old system said.
                    pricedAt: at,
                    completedAt: at,
                    computedTotal: openingBalance,
                    chargedTotal: openingBalance,
                })
                .returning();

            if (!visit) throw AppError.internal('opening balance visit insert returned nothing');

            return { patient: toPatient(row), openingBalanceVisitId: visit.id };
        });
    },

    /**
     * `patients` is the whole register rather than this session's tally — the
     * screen counts its own session, and the two answer different questions:
     * how many she has done today, and how many are in the system at all.
     */
    async progress(): Promise<MigrationProgress> {
        const [entered] = await db.select({ total: count() }).from(patients);

        const [carried] = await db
            .select({
                total: count(),
                amount: sql<number>`COALESCE(SUM(${visits.chargedTotal}), 0)::int`,
            })
            .from(visits)
            .innerJoin(appointments, eq(visits.appointmentId, appointments.id))
            .where(eq(appointments.isOpeningBalance, true));

        return {
            patients: entered?.total ?? 0,
            openingBalances: carried?.total ?? 0,
            openingBalanceTotal: carried?.amount ?? 0,
        };
    },
};
