/**
 * How late the day is running, and what every booked time means because of it.
 *
 * One thing slips a day, and it is the chair: the patient in it stays longer
 * than the slot allowed for. That is time already spent, measured against the
 * clock, and nothing in the layout knows about it yet.
 *
 * A walk-in is not the second reason, though it looks like one. Taking a
 * walk-in *writes* — the server seats it and pushes every booked row it runs
 * into past its end (`makeRoomForWalkIn`) — so by the time the day is drawn,
 * those minutes are already inside the `startsAt` of everyone after it. Adding
 * them again here would count them twice and overstate every projection below
 * by the whole walk-in. It is the same rule that keeps a merely-waiting booked
 * patient out of the sum: anything owning a slot in the day is already in the
 * day.
 *
 * Nothing here writes. `startsAt` stays the time the patient was told on the
 * phone — rewriting thirty rows because the chair overran is a lie the moment
 * the day catches up, and the day usually does. The projection is drawn beside
 * the booked time, never instead of it, and unwinds by itself as the chair
 * empties.
 *
 * The delay is rounded up to `MIN_SLOT_STEP`, so every projection lands on the
 * same grid the booking grid tiles by. "6:17" is a false precision — the chair
 * does not empty to the minute, and a column of 6:17 / 6:47 / 7:07 is harder to
 * read than 6:20 / 7:50 / 7:10 while claiming to know more. Rounding the delay
 * once rather than each row keeps the day in its booked order and evenly
 * spaced; rounding *up* keeps it honest, because a time promised early is the
 * one that gets the desk in trouble.
 *
 * Minutes-from-midnight, local time, the same currency as `booking.ts` and
 * `hours.ts`.
 */

import { isSettled } from './agenda';
import { MIN_SLOT_STEP } from './booking';
import { arrivalQueue } from './chair';
import type { Appointment } from './data/types';
import { formatDuration, minutesOfDay } from './time';

export interface DayDelay {
    /** How far behind the day is, to the slot: everything booked slides by this. */
    minutes: number;
    /** What the patient in the chair has overrun their slot by, to the minute. */
    fromChair: number;
}

export const ON_TIME: DayDelay = { minutes: 0, fromChair: 0 };

/**
 * `checkedInAt` is the same map the chair reads, so both agree on who is
 * seated. `nowMinutes` is null on any day that is not today: a day the clock
 * has not reached cannot be running late, and one already gone is not still
 * slipping.
 */
export function dayDelay(
    appointments: readonly Appointment[],
    nowMinutes: number | null,
    checkedInAt: ReadonlyMap<string, string> = new Map(),
): DayDelay {
    if (nowMinutes === null) return ON_TIME;

    const { chair } = arrivalQueue(appointments, checkedInAt);

    const fromChair = chair
        ? Math.max(0, nowMinutes - (minutesOfDay(chair.startsAt) + chair.durationMinutes))
        : 0;

    return { minutes: toSlot(fromChair), fromChair };
}

/**
 * When a booking is realistically going to start. A settled row is history and
 * does not move; a time that has already gone by cannot be projected into the
 * past, so it is held at now — the honest answer for the patient whose 3:00 it
 * is at 3:20 is "you are next", not "3:00".
 */
export function projectedStart(appointment: Appointment, delay: DayDelay, nowMinutes: number | null): number {
    const booked = minutesOfDay(appointment.startsAt);
    if (delay.minutes === 0 || isSettled(appointment)) return booked;

    const projected = booked + delay.minutes;
    return nowMinutes === null ? projected : Math.max(projected, toSlot(nowMinutes));
}

/** Up to the next slot boundary. Never down: an early promise is the costly one. */
function toSlot(minutes: number): number {
    return Math.ceil(minutes / MIN_SLOT_STEP) * MIN_SLOT_STEP;
}

/** Whether a row is worth drawing a projection on at all. */
export function isProjected(appointment: Appointment, delay: DayDelay): boolean {
    return delay.minutes > 0 && !isSettled(appointment) && appointment.status === 'booked';
}

/**
 * "21 min late", "1h 5m late" — the day's headline, or null when it is on time.
 *
 * The overrun to the minute, not the slot-rounded `minutes`. The banner used to
 * carry both — "Running 25 min late" over "the chair is 21 min over" — and two
 * figures for one fact read as a contradiction. The rounding is for where booked
 * times slide to; the headline says how late it actually is.
 */
export function delayLabel(delay: DayDelay): string | null {
    return delay.fromChair > 0 ? `${formatDuration(delay.fromChair)} late` : null;
}
