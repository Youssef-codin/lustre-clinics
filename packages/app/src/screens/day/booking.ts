/**
 * The times a booking may start on a given day. The server is the authority —
 * double-booking is a Postgres exclusion constraint and only it can settle a
 * race — but a grid that offers a slot already gone is how a secretary tells a
 * patient on the phone they are booked and then finds they are not, so the
 * taken times are drawn from the day already fetched and offered as taken.
 * Cancelled and no-show rows hold no slot (`holdsSlot`), so a cancellation
 * frees its time here the moment the day is refetched.
 *
 * Slots step by the length of the visit being booked, from opening — a fixed
 * quarter-hour step was written when the clinic's lengths were 15/30/45, and it
 * survived them becoming 10/20/30/45: a 20-minute visit cannot start at 10:20
 * on a quarter-hour grid, so choosing a different length changed which of the
 * same times were free and never which times were offered. Stepping by the
 * duration tiles the day, and asking for a longer visit visibly thins the grid.
 *
 * Only the tiling. Offering the moment each existing booking ends would squeeze
 * a start into every gap, but a desk does not say "five fifty-three" to anyone
 * — the times have to be times a person would agree to out loud, and a clean
 * grid is worth more than the odd recovered quarter of an hour.
 *
 * Nothing is offered past closing either. A day that overruns is real, but it
 * is not something the desk *books*: it is handled by the day running late and
 * every later time sliding with it (`delay.ts`), which is a projection over the
 * booked day, not a slot anyone chose. A slot that starts before closing and
 * ends after is still offered — clinics do overrun — and says so.
 *
 * Everything here is minutes-from-midnight, local time, the same currency
 * `hours.ts` and the timeline use.
 */
import type { Appointment, ClinicDay } from './data/types';
import { hoursFor, isClosed } from './hours';
import { holdsSlot } from './month';
import { addDays, clock12, formatDate, minutesOfDay, relativeDayLabel } from './time';

/** No grid finer than this, however short the visit — five-minute chips are a wall. */
export const MIN_SLOT_STEP = 5;

export type SlotState = 'free' | 'taken' | 'past';

export interface Slot {
    minutes: number;
    state: SlotState;
    /** The visit would end after the clinic closes. Bookable, but said out loud. */
    runsLate: boolean;
}

export interface SlotsInput {
    dateKey: string;
    schedule: readonly ClinicDay[] | undefined;
    /** The day's rows, already scoped to the branch being booked into. */
    appointments: readonly Appointment[];
    /** The branch being booked into — whose hours the grid is drawn from. */
    branchId: string | null;
    durationMinutes: number;
    /** Minutes into today, or null when the day being booked is not today. */
    nowMinutes: number | null;
}

export function slotsFor({
    dateKey,
    schedule,
    appointments,
    branchId,
    durationMinutes,
    nowMinutes,
}: SlotsInput): Slot[] {
    const hours = hoursFor(dateKey, schedule, branchId);
    if (!hours) return [];

    const busy = appointments.filter(holdsSlot).map((row) => {
        const start = minutesOfDay(row.startsAt);
        return { start, end: start + row.durationMinutes };
    });

    const step = Math.max(durationMinutes, MIN_SLOT_STEP);

    const starts: number[] = [];
    for (let minutes = hours.opens; minutes < hours.closes; minutes += step) {
        starts.push(minutes);
    }

    return starts.map((minutes) => {
        const end = minutes + durationMinutes;
        const taken = busy.some((row) => minutes < row.end && row.start < end);
        const past = nowMinutes !== null && minutes < nowMinutes;

        return {
            minutes,
            state: taken ? 'taken' : past ? 'past' : 'free',
            runsLate: end > hours.closes,
        };
    });
}

/** The time the sheet opens on: the first one that can actually be booked. */
export function firstFreeSlot(slots: readonly Slot[]): number | null {
    return slots.find((slot) => slot.state === 'free')?.minutes ?? null;
}

/** Whether a time the user already picked survived a change of day or length. */
export function slotIsFree(slots: readonly Slot[], minutes: number | null): boolean {
    if (minutes === null) return false;
    return slots.some((slot) => slot.minutes === minutes && slot.state === 'free');
}

/** The days ahead the branch actually works, starting today. */
export function workingDaysIn(
    today: string,
    days: number,
    schedule: readonly ClinicDay[] | undefined,
    branchId: string | null,
): string[] {
    return Array.from({ length: days }, (_, index) => addDays(today, index)).filter(
        (key) => !isClosed(key, schedule, branchId),
    );
}

/**
 * The days a booking may be offered: the strip's window, and one day beyond it
 * that was asked for by name.
 *
 * The two are asked for differently and that is why they are not one list. The
 * window answers "when can they come in", which is a question about the next
 * couple of weeks and is worth fetching whole. A day in March is not that
 * question — the desk already knows the day, from the phone call or from the
 * screen it opened this from — and reaching it by widening the window would
 * fetch a quarter of a year of appointments to offer one day of it, and hand
 * the strip a hundred chips to scroll through.
 *
 * Keys are `YYYY-MM-DD`, so sorting them as strings sorts them as dates.
 */
export function daysOffered(
    today: string,
    windowDays: number,
    farDay: string | null,
    schedule: readonly ClinicDay[] | undefined,
    branchId: string | null,
): string[] {
    const window = workingDaysIn(today, windowDays, schedule, branchId);
    if (!farDay || farDay < today || window.includes(farDay)) return window;
    if (isClosed(farDay, schedule, branchId)) return window;
    return [...window, farDay].sort();
}

export interface Fortnight {
    slotsByDay: Map<string, Slot[]>;
    /** Only the days with room left for a visit this long — what a strip may offer. */
    openDays: string[];
}

export interface FortnightInput {
    /** The working days, in order. `fetched` is indexed against this. */
    days: readonly string[];
    /** One day's rows per entry of `days`, or undefined while the read is in flight. */
    fetched: readonly (readonly Appointment[])[] | undefined;
    schedule: readonly ClinicDay[] | undefined;
    branchId: string | null;
    durationMinutes: number;
    today: string;
    nowMinutes: number;
}

/**
 * A fortnight of days resolved to the times each still has free. A day that has
 * not answered yet has no taken times *to* know about, and `slotsFor([])` says
 * every hour is free — which is how a grid comes to offer a slot someone else is
 * already in. So until the rows are in hand nothing is offered at all, and
 * `openDays` is empty rather than everything.
 */
export function fortnightSlots({
    days,
    fetched,
    schedule,
    branchId,
    durationMinutes,
    today,
    nowMinutes,
}: FortnightInput): Fortnight {
    const slotsByDay = new Map<string, Slot[]>();
    if (!fetched) return { slotsByDay, openDays: [] };

    days.forEach((key, index) => {
        slotsByDay.set(
            key,
            slotsFor({
                dateKey: key,
                schedule,
                appointments: (fetched[index] ?? []).filter((row) => row.branchId === branchId),
                branchId,
                durationMinutes,
                nowMinutes: key === today ? nowMinutes : null,
            }),
        );
    });

    return {
        slotsByDay,
        openDays: days.filter((key) => (slotsByDay.get(key) ?? []).some((slot) => slot.state === 'free')),
    };
}

/**
 * A day as it is said out loud mid-sentence — "tomorrow at 3:00 PM". A date far
 * enough out to be named rather than described keeps its capital.
 */
export function dayLabel(key: string): string {
    const label = relativeDayLabel(key);
    return label === formatDate(key) ? label : label.toLowerCase();
}

/**
 * The meridiem is `clock12`'s to case, not this function's. It used to be
 * lowercased here and in the slot grid, which is the one thing the 12-hour
 * decision forbids — no screen formats a time itself — and it only ever
 * diverged in English: `clock12` returns a localized meridiem, so lowercasing
 * ص/م is a no-op and Arabic never showed the drift.
 */
export function timeLabel(minutes: number): string {
    const { time, meridiem } = clock12(minutes);
    return `${time} ${meridiem}`;
}
