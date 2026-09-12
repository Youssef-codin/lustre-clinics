/**
 * Every call the day view makes, in one file, over the real tRPC client, typed
 * from `AppRouter` so a procedure that moves fails here at compile time. Two
 * things are done by hand: dates arrive as ISO strings — there is no
 * transformer either side, so the inferred types say `Date` while the wire
 * carries strings, and `shaped`/`types.ts` bridge that gap until a transformer
 * lands — and `wrap` turns tRPC failures into the `RequestError` the screens
 * localize from. Offsets come from the date itself (`offsetForDate`) because a
 * day on the far side of a DST changeover needs the offset in force on it;
 * `byDates` is one POST over `httpBatchLink`, not thirty-one round trips.
 * Neither read carries a branch, though the procedure takes one: a day is a
 * few dozen rows, and the screens split it themselves so they can open on the
 * branch holding most of it and say what the other one is doing — which a
 * server-side filter throws away before the app can see it. The
 * visit id is not on the appointment, so `visitIds` keeps what this session
 * created and `visit.byAppointment` reaches the rest; `checkInTimes` orders
 * the waiting room by arrival, dropping a patient whose visit cannot be read
 * so the order falls back to `updatedAt` and the day still draws.
 */
import type { PaymentMethod, Tooth } from '@lustre/shared';
import { errorCodeOf, isOffline, trpcClient } from '../../../api';
import { offsetForDate } from '../time';
import { RequestError } from './client';
import type {
    Appointment,
    AppointmentRow,
    Branch,
    ClinicDay,
    ClinicSettings,
    Patient,
    PendingReminder,
    ProcedureCategory,
    ProcedureType,
    Visit,
    VisitRow,
    WalkInResult,
} from './types';

/**
 * §7 — a procedure the booking plans. No price: the visit snapshots the
 * catalogue's at check-in, so what the client sends is what is to be done, not
 * what it costs. `tooth` is required by §5 for a tooth-specific procedure and
 * refused for the rest, which is why the picker asks the tooth first.
 */
export interface BookedProcedure {
    procedureId: string;
    quantity?: number;
    tooth?: Tooth | null;
    note?: string | null;
}

/**
 * §7/§13: book for someone on file, or create them with the appointment. A new
 * patient needs a name and a number and nothing else; the rest of the record is
 * sent when the secretary already has it, and is `null` — not absent — when she
 * does not, so the field reads as asked-and-unknown rather than never-asked.
 */
export type PatientRef =
    | { kind: 'existing'; patientId: string }
    | {
          kind: 'new';
          name: string;
          phone: string;
          email?: string | null;
          birthDate?: string | null;
          gender?: string | null;
          notes?: string | null;
      };

function shaped<T>(value: unknown): T {
    return value as T;
}

async function wrap<T>(run: () => Promise<unknown>): Promise<T> {
    try {
        return shaped<T>(await run());
    } catch (err) {
        if (err instanceof RequestError) throw err;
        throw new RequestError(errorCodeOf(err), err instanceof Error ? err.message : 'request failed', {
            offline: isOffline(err),
            cause: err,
        });
    }
}

export const api = {
    schedule: (): Promise<ClinicDay[]> => wrap(() => trpcClient.settings.schedule.query()),

    settings: (): Promise<ClinicSettings> => wrap(() => trpcClient.settings.get.query()),

    branches: (): Promise<Branch[]> => wrap(() => trpcClient.branch.list.query({ includeInactive: false })),

    byDate: (date: string): Promise<Appointment[]> =>
        wrap(() =>
            trpcClient.appointment.byDate.query({
                date,
                offsetMinutes: offsetForDate(date),
            }),
        ),

    byDates: (dates: readonly string[]): Promise<Appointment[][]> =>
        wrap(() =>
            Promise.all(
                dates.map((date) =>
                    trpcClient.appointment.byDate.query({
                        date,
                        offsetMinutes: offsetForDate(date),
                    }),
                ),
            ),
        ),

    procedures: (): Promise<ProcedureType[]> => wrap(() => trpcClient.procedure.list.query()),

    procedureTree: (): Promise<ProcedureCategory[]> =>
        wrap(() => trpcClient.procedure.tree.query({ includeInactive: false })),

    pendingReminders: (date: string): Promise<PendingReminder[]> =>
        wrap(() =>
            trpcClient.reminder.pending.query({
                dueOnly: true,
                limit: 100,
                offsetMinutes: offsetForDate(date),
            }),
        ),

    markReminderSent: (id: string): Promise<unknown> =>
        wrap(() => trpcClient.reminder.markSent.mutate({ id })),

    markReminderSkipped: (id: string): Promise<unknown> =>
        wrap(() => trpcClient.reminder.markSkipped.mutate({ id })),

    /**
     * Quiet today's nudge without touching the list. Not the same as skipping:
     * the reminders stay pending and still have to go out — this only says the
     * desk has been told enough for one day. Per calendar day, so tomorrow's
     * nudge arms on its own.
     */
    dismissRemindersToday: (date: string): Promise<unknown> =>
        wrap(() => trpcClient.reminder.dismissToday.mutate({ date })),

    searchPatients: (q: string): Promise<Patient[]> =>
        wrap(() => trpcClient.patient.search.query({ q, limit: 8 })),

    checkIn: (appointmentId: string): Promise<VisitRow> =>
        wrap(() => trpcClient.visit.checkIn.mutate({ appointmentId })),

    walkIn: (input: {
        patient: PatientRef;
        branchId: string;
        durationMinutes?: number;
        procedures?: BookedProcedure[];
        note?: string | null;
        offsetMinutes: number;
    }): Promise<WalkInResult> => wrap(() => trpcClient.appointment.walkIn.mutate(input)),

    create: (input: {
        patient: PatientRef;
        branchId: string;
        startsAt: string;
        durationMinutes?: number;
        procedures?: BookedProcedure[];
        note?: string | null;
        offsetMinutes: number;
    }): Promise<AppointmentRow> => wrap(() => trpcClient.appointment.create.mutate(input)),

    cancel: (id: string): Promise<AppointmentRow> => wrap(() => trpcClient.appointment.cancel.mutate({ id })),

    markNoShow: (id: string): Promise<AppointmentRow> =>
        wrap(() => trpcClient.appointment.update.mutate({ id, status: 'no_show' })),

    awaitPayment: (id: string): Promise<AppointmentRow> =>
        wrap(() => trpcClient.appointment.awaitPayment.mutate({ id })),

    /**
     * Replaces the visit's whole list — the procedure does not patch a line
     * (§8), which is why the visit screen holds the draft and sends all of it.
     * Omitting `unitPrice` would take the catalogue's price back, so the screen
     * always sends what is on it, including a price it never edited.
     */
    setProcedures: (input: {
        visitId: string;
        procedures: Array<{
            procedureId: string;
            quantity?: number;
            unitPrice?: number;
            tooth?: Tooth | null;
            note?: string | null;
        }>;
    }): Promise<Visit> => wrap(() => trpcClient.visit.setProcedures.mutate(input)),

    checkOut: (input: {
        visitId: string;
        chargedTotal: number;
        paidTotal: number;
        method: PaymentMethod;
        methodNote?: string | null;
    }): Promise<Visit> => wrap(() => trpcClient.visit.checkOut.mutate(input)),

    /**
     * What the visit was paid, in total, rather than another payment on top —
     * the one way a figure that was entered too high comes back down. The
     * server writes the difference, so correcting 800 to 500 leaves both the
     * 800 and the refund of 300 on the record.
     */
    setPaid: (input: {
        visitId: string;
        paidTotal: number;
        method: PaymentMethod;
        methodNote?: string | null;
    }): Promise<Visit> => wrap(() => trpcClient.visit.setPaid.mutate(input)),

    visitById: (id: string): Promise<Visit> => wrap(() => trpcClient.visit.byId.query({ id })),

    appointmentById: (id: string): Promise<Appointment> =>
        wrap(() => trpcClient.appointment.byId.query({ id })),

    /**
     * Unlock a finished visit so it can be corrected. Payments already taken
     * survive it, so the visit reopens owing whatever is left after them, and
     * the appointment stays `done` — the patient went home, and an edit that is
     * opened and backed out of must not leave them on the day view as though
     * they were standing at the desk.
     */
    reopenVisit: (visitId: string): Promise<Visit> => wrap(() => trpcClient.visit.reopen.mutate({ visitId })),
};

/**
 * The patient is through the door — checked in, and what they are here for
 * recorded, in that order and only on confirmation. Nothing is written while
 * the arrival screen is merely open, so backing out of it leaves an
 * appointment that is still `booked` rather than a patient the day view says
 * has arrived and has not.
 *
 * `edited` is what decides whether the list is sent at all. Check-in already
 * seeds the visit from the booking and adds the clinic's checkup line (§9); an
 * untouched list is that same list, and re-sending it would only risk
 * disagreeing with it. When it *was* touched, the checkup the server chose is
 * carried across rather than recomputed here — the waiver rule is the server's
 * and a second copy of it in the client is a copy that drifts.
 */
export async function arrive(input: {
    appointmentId: string;
    procedures: Array<{ procedureId: string; quantity: number; unitPrice: number; tooth: Tooth | null }>;
    edited: boolean;
}): Promise<Visit> {
    const row = await api.checkIn(input.appointmentId);
    rememberVisit(input.appointmentId, row.id);

    if (!input.edited) return api.visitById(row.id);

    const seeded = await api.visitById(row.id);
    const checkup = seeded.procedures.filter(
        (line) => line.isCheckup && !input.procedures.some((row) => row.procedureId === line.procedureId),
    );

    return api.setProcedures({
        visitId: row.id,
        procedures: [
            ...input.procedures,
            ...checkup.map((line) => ({
                procedureId: line.procedureId,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                tooth: line.tooth,
            })),
        ],
    });
}

/**
 * Correct a visit's lines, reopening it first if it was closed. The two go
 * together on purpose: `visit.setProcedures` is refused on a checked-out visit,
 * so the reopen is part of the write rather than the price of opening the
 * editor. Opening it and backing out has to leave the visit exactly as closed
 * as it was found — the same rule the arrival screen follows, where nothing is
 * written until Confirm.
 */
export async function amend(input: {
    visitId: string;
    closed: boolean;
    procedures: Array<{ procedureId: string; quantity: number; unitPrice: number; tooth: Tooth | null }>;
}): Promise<Visit> {
    // `closed` is what the screen was opened on, which a failed attempt has
    // already made stale: the reopen lands, `setProcedures` is refused for a
    // duplicate tooth, and the visit is now open while the screen still thinks
    // it is closed. Reopening it a second time is refused — `reopen` cannot
    // tell an already-corrected visit from one that was never checked out —
    // and that refusal would replace the real complaint about the tooth with
    // one about the checkout, on every retry. So the state is re-read rather
    // than assumed, and only on the path that might need it.
    if (input.closed) {
        const current = await api.visitById(input.visitId);
        if (current.completedAt) await api.reopenVisit(input.visitId);
    }

    return api.setProcedures({ visitId: input.visitId, procedures: input.procedures });
}

const visitIds = new Map<string, string>();

function rememberVisit(appointmentId: string, visitId: string): void {
    visitIds.set(appointmentId, visitId);
}

/**
 * Two clocks per patient, because arriving and being seated are two events.
 * `checkedInAt` is when the wait started and orders the queue; `inChairAt` is
 * when it ended and is what the chair's progress bar measures from. A patient
 * still waiting has no `inChairAt` entry at all.
 */
export interface Arrivals {
    checkedInAt: ReadonlyMap<string, string>;
    inChairAt: ReadonlyMap<string, string>;
}

/**
 * The `visits` row and nothing else. Separate from `visitForAppointment`
 * because the day view calls this once per appointment and must not pay for
 * detail it does not read — the two stamps it wants are both on the row.
 */
async function visitRowForAppointment(appointmentId: string): Promise<VisitRow | null> {
    const row = await wrap<VisitRow | null>(() => trpcClient.visit.byAppointment.query({ appointmentId }));
    if (row) visitIds.set(appointmentId, row.id);
    return row;
}

export async function checkInTimes(appointmentIds: readonly string[]): Promise<Arrivals> {
    const visits = await Promise.all(
        appointmentIds.map((id) => visitRowForAppointment(id).catch(() => null)),
    );

    const checkedInAt = new Map<string, string>();
    const inChairAt = new Map<string, string>();

    visits.forEach((visit, index) => {
        const id = appointmentIds[index];
        if (!visit || !id) return;
        checkedInAt.set(id, visit.checkedInAt);
        if (visit.inChairAt) inChairAt.set(id, visit.inChairAt);
    });

    return { checkedInAt, inChairAt };
}

/**
 * The whole visit, for the screens that draw one.
 *
 * `visit.byAppointment` answers with the `visits` row alone — no procedures, no
 * payments, and none of the derived `paidTotal` or `balance` — so its result
 * can never be handed to a screen. It used to be, cast straight to `Visit` by
 * `wrap`, and because that cast is unchecked nothing failed to compile: the
 * first open of any visit this session had not created threw inside the render
 * (`VisitViewScreen` reads `visit.procedures`) and the pane's boundary caught it
 * as "this tab stopped working". The second open worked, which is what made it
 * look random — the failed call had cached the id on its way past, so the next
 * one took the `visitById` branch and got the real shape.
 *
 * So the id is resolved here and the visit is always read back through
 * `visitById`. Only the first open of an unknown appointment pays for the
 * second call; every later one is a cache hit, as before.
 */
export async function visitForAppointment(appointmentId: string): Promise<Visit | null> {
    const known = visitIds.get(appointmentId) ?? (await visitRowForAppointment(appointmentId))?.id;
    return known ? api.visitById(known) : null;
}
