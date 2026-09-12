/**
 * There is no renderer under `bun test`, so what is tested here is the part of
 * the screen that is not React: which day is closed, where a block lands, and —
 * the one that matters — what the secretary is told when Postgres refuses a
 * double booking.
 */
import { describe, expect, it } from 'bun:test';
import { type AppointmentStatus, ERROR_CODE, type Tooth } from '@lustre/shared';
import { procedureLabel, splitDay } from './agenda';
import {
    daysOffered,
    firstFreeSlot,
    fortnightSlots,
    type Slot,
    slotIsFree,
    slotsFor,
    timeLabel,
    workingDaysIn,
} from './booking';
import { slotProgress, splitDeskDay, splitDoctorDay, standingFor } from './chair';
import { RequestError } from './data/client';
import type { Appointment, ProcedureCategory } from './data/types';
import { dayDelay, delayLabel, isProjected, ON_TIME, projectedStart } from './delay';
import { emptyDay } from './empty';
import { describeError } from './errors';
import { hoursFor, isClosed, openMinutes } from './hours';
import { amountDue, formatAmount, formatMoney, poundsEntry } from './money';
import { busiestBranch, loadsFrom } from './month';
import {
    birthDateDigits,
    birthDateDisplay,
    birthDateError,
    birthDateIso,
    EMPTY_PATIENT_DRAFT,
    emailError,
    patientRefOf,
} from './patientDraft';
import {
    bookedProcedures,
    checkupToAdd,
    describeProcedure,
    groupByTooth,
    offeredFor,
    type PlannedProcedure,
    QUADRANTS,
    toothPosition,
    totalOf,
} from './procedures';
import {
    addDays,
    clock12,
    clockToMinutes,
    dateKey,
    formatDatePill,
    formatElapsed,
    formatLongDate,
    isoAt,
    minutesOfDay,
    relativeDayLabel,
    secondsOfDay,
} from './time';

const FRIDAY = '2026-08-07';
const SATURDAY = '2026-08-08';

describe('clinic hours', () => {
    it('falls back to the defaults when the clinic has never set a schedule', () => {
        expect(hoursFor(SATURDAY, undefined)).toEqual({ opens: 600, closes: 1320 });
        expect(hoursFor(SATURDAY, [])).toEqual({ opens: 600, closes: 1320 });
    });

    it('closes the default rest day', () => {
        expect(isClosed(FRIDAY, undefined)).toBe(true);
        expect(openMinutes(FRIDAY, undefined)).toBe(0);
    });

    it('lets a saved schedule win, and a missing weekday means closed', () => {
        const schedule = [{ weekday: 5, branchId: 'b', opensAt: '09:00', closesAt: '13:00' }];

        expect(hoursFor(FRIDAY, schedule)).toEqual({ opens: 540, closes: 780 });
        expect(isClosed(SATURDAY, schedule)).toBe(true);
    });
});

describe('the agenda', () => {
    const at = (id: string, time: string, status: AppointmentStatus): Appointment =>
        ({
            id,
            startsAt: `2026-08-10T${time}:00+03:00`,
            status,
            durationMinutes: 30,
            patient: { id: `p-${id}`, name: id, phone: '' },
        }) as Appointment;

    it('folds away what is settled and keeps what still needs doing', () => {
        const { past, upcoming } = splitDay(
            [
                at('done', '09:30', 'done'),
                at('missed', '10:00', 'no_show'),
                at('stale', '10:45', 'booked'),
                at('later', '13:00', 'booked'),
            ],
            null,
        );

        expect(past.map((row) => row.id)).toEqual(['done', 'missed']);
        expect(upcoming.map((row) => row.id)).toEqual(['stale', 'later']);
    });

    // The fold is relative to now, so only today has one. A past day is every
    // row settled, and folding them all away drew nothing at all under a tab
    // pill that went on counting them.
    it('folds nothing off today, and still puts the day in order', () => {
        const { past, upcoming } = splitDay(
            [at('later', '13:00', 'done'), at('done', '09:30', 'done'), at('missed', '10:00', 'no_show')],
            null,
            false,
        );

        expect(past).toEqual([]);
        expect(upcoming.map((row) => row.id)).toEqual(['done', 'missed', 'later']);
    });

    it('does not draw the patient in the chair twice', () => {
        const { upcoming } = splitDay(
            [at('chair', '11:00', 'checked_in'), at('next', '11:30', 'booked')],
            'chair',
        );
        expect(upcoming.map((row) => row.id)).toEqual(['next']);
    });

    it('puts the day in order whatever order it arrived in', () => {
        const { upcoming } = splitDay([at('b', '13:00', 'booked'), at('a', '09:00', 'booked')], null);
        expect(upcoming.map((row) => row.id)).toEqual(['a', 'b']);
    });

    it('labels a row with every procedure the booking planned', () => {
        const planned = (...names: string[]): Appointment =>
            ({
                ...at('x', '09:00', 'booked'),
                procedures: names.map((name, i) => ({
                    id: `l-${i}`,
                    procedureId: `p-${i}`,
                    name,
                    quantity: 1,
                    tooth: null,
                    note: null,
                })),
            }) as Appointment;

        expect(procedureLabel(planned('Consultation'))).toBe('Consultation');
        expect(procedureLabel(planned('Consultation', 'Zirconia crown'))).toBe(
            'Consultation · Zirconia crown',
        );
        // Nothing planned is not "unknown procedure" — the row falls back to
        // the duration alone, as it did when `type_id` was null.
        expect(procedureLabel(planned())).toBeUndefined();
    });
});

describe("the doctor's day", () => {
    const at = (id: string, time: string, status: AppointmentStatus, updatedAt = time): Appointment =>
        ({
            id,
            startsAt: `2026-08-10T${time}:00+03:00`,
            updatedAt: `2026-08-10T${updatedAt}:00+03:00`,
            status,
            durationMinutes: 30,
            patient: { id: `p-${id}`, name: id, phone: '' },
        }) as Appointment;

    const arrivals = (pairs: Record<string, string>) =>
        new Map(Object.entries(pairs).map(([id, time]) => [id, `2026-08-10T${time}:00+03:00`]));

    it('seats whoever checked in first and leaves the rest waiting', () => {
        const day = splitDoctorDay(
            [at('second', '11:35', 'checked_in'), at('first', '11:05', 'checked_in')],
            arrivals({ first: '11:02', second: '11:20' }),
        );

        expect(day.chair?.id).toBe('first');
        expect(day.waiting.map((row) => row.id)).toEqual(['second']);
    });

    it('gives the card to the patient waiting and the strip to the chair', () => {
        const day = splitDoctorDay(
            [
                at('chair', '11:05', 'checked_in'),
                at('waiting', '11:35', 'checked_in'),
                at('booked', '12:00', 'booked'),
            ],
            arrivals({ chair: '11:02', waiting: '11:20' }),
        );

        expect(day.headline?.id).toBe('waiting');
        expect(day.strip?.id).toBe('chair');
        expect(day.list.map((row) => row.id)).toEqual(['booked']);
    });

    it('puts the next slot on the card while the chair keeps the strip', () => {
        const day = splitDoctorDay(
            [at('chair', '11:05', 'checked_in'), at('booked', '12:00', 'booked')],
            arrivals({ chair: '11:02' }),
        );

        expect(day.headline?.id).toBe('booked');
        expect(day.strip?.id).toBe('chair');
        expect(day.list).toEqual([]);
    });

    it('hands the card back to the chair when there is nothing after it', () => {
        const day = splitDoctorDay([at('chair', '11:05', 'checked_in')], arrivals({ chair: '11:02' }));

        expect(day.headline?.id).toBe('chair');
        expect(day.strip).toBeNull();
    });

    it('orders the queue by updatedAt when the visits are not to hand', () => {
        const day = splitDoctorDay([
            at('late', '11:05', 'checked_in', '11:30'),
            at('early', '11:35', 'checked_in', '11:10'),
        ]);

        expect(day.chair?.id).toBe('early');
    });

    it('folds a patient sent to the desk away with the rest of the history', () => {
        const day = splitDoctorDay([
            at('paid', '09:30', 'done'),
            at('desk', '10:00', 'awaiting_payment'),
            at('booked', '12:00', 'booked'),
        ]);

        expect(day.past.map((row) => row.id)).toEqual(['paid', 'desk']);
        expect(day.list).toEqual([]);
        expect(day.headline?.id).toBe('booked');
    });

    it('seats the same patient the desk does', () => {
        const rows = [at('second', '11:35', 'checked_in'), at('first', '11:05', 'checked_in')];
        const when = arrivals({ first: '11:02', second: '11:20' });

        expect(splitDeskDay(rows, when).chair?.id).toBe(splitDoctorDay(rows, when).chair?.id);
    });

    it('holds the desk card on the patient who still owes, and seats the next', () => {
        const day = splitDeskDay(
            [
                at('desk', '11:05', 'awaiting_payment', '11:40'),
                at('waiting', '11:35', 'checked_in'),
                at('booked', '12:00', 'booked'),
            ],
            arrivals({ waiting: '11:20' }),
        );

        expect(day.card?.id).toBe('desk');
        expect(day.chair?.id).toBe('waiting');
    });

    it('falls back to the chair, then to the next booking, for the card', () => {
        const seated = [at('chair', '11:05', 'checked_in'), at('booked', '12:00', 'booked')];

        expect(splitDeskDay(seated, arrivals({ chair: '11:02' })).card?.id).toBe('chair');
        expect(splitDeskDay([at('booked', '12:00', 'booked')]).card?.id).toBe('booked');
        expect(splitDeskDay([at('paid', '09:30', 'done')]).card).toBeNull();
    });

    // The trap `standingFor` exists for: `awaiting_payment` means standing at
    // the desk today, and a visit never settled on a day gone by. The date
    // tells them apart.
    it('calls an unsettled visit from another day finished, not at the desk', () => {
        const old = at('old', '11:05', 'awaiting_payment');

        expect(standingFor(old, '2026-08-10')).toBe('desk');
        expect(standingFor(old, '2026-08-27')).toBe('finished');
    });

    it('calls a closed visit finished whatever day it is read on', () => {
        expect(standingFor(at('closed', '11:05', 'done'), '2026-08-10')).toBe('finished');
    });

    // Seconds matter here: the count is a stopwatch, and the stamp it starts
    // from carries them.
    const stamp = (time: string, seconds = 0) =>
        `2026-08-10T${time}:${String(seconds).padStart(2, '0')}+03:00`;

    // The bar measures the visit, so it starts when the patient was checked in
    // rather than when the slot was booked. A patient the card calls IN THE
    // CHAIR reads zero only at the moment they are seated.
    it('runs the booked duration from the check-in, not the booked start', () => {
        const appointment = at('chair', '12:00', 'checked_in');
        const seated = minutesOfDay(stamp('08:47'));

        expect(slotProgress(appointment, seated, stamp('08:47')).label).toBe('0:00 / 30 min');
        expect(slotProgress(appointment, seated + 15, stamp('08:47')).label).toBe('15:00 / 30 min');
        expect(slotProgress(appointment, seated + 15, stamp('08:47')).value).toBe(0.5);
    });

    // The `0 / 223 min` regression. It came from the denominator — the old rule
    // set it to `bookedEnd - checkedInAt` — and not from the start point, so
    // starting at the check-in is safe as long as the whole stays the booked
    // duration.
    it('never lets an early arrival stretch the denominator', () => {
        const appointment = at('chair', '12:00', 'checked_in');
        const seated = minutesOfDay(stamp('08:47'));

        expect(slotProgress(appointment, seated, stamp('08:47')).label).toBe('0:00 / 30 min');
        expect(slotProgress(appointment, seated, stamp('08:47')).label).not.toContain('223');
    });

    // Deliberate, and the other half of measuring the visit: someone seated
    // half an hour late still needs the whole procedure, so the bar gives them
    // the whole slot. Running late is the day's problem, and `dayDelay` has it.
    it('gives a patient seated late their full slot', () => {
        const appointment = at('chair', '11:00', 'checked_in');
        const seated = minutesOfDay(stamp('11:30'));

        expect(slotProgress(appointment, seated + 15, stamp('11:30')).label).toBe('15:00 / 30 min');
        expect(slotProgress(appointment, seated + 15, stamp('11:30')).over).toBe(false);
    });

    it('says so once the visit runs over', () => {
        const appointment = at('chair', '11:00', 'checked_in');
        const seated = minutesOfDay(stamp('11:00'));

        expect(slotProgress(appointment, seated + 15, stamp('11:00')).label).toBe('15:00 / 30 min');
        expect(slotProgress(appointment, seated + 45, stamp('11:00')).over).toBe(true);
        expect(slotProgress(appointment, seated + 45, stamp('11:00')).label).toBe('15:00 over');
    });

    // Whoever is at the desk has no arrival to measure from — the card draws
    // them without a bar, and the fallback keeps the window honest anyway.
    it('falls back to the booked slot with no check-in to hand', () => {
        const appointment = at('chair', '11:00', 'checked_in');
        const start = minutesOfDay(appointment.startsAt);

        expect(slotProgress(appointment, start - 193).label).toBe('0:00 / 30 min');
        expect(slotProgress(appointment, start + 15).label).toBe('15:00 / 30 min');
        expect(slotProgress(appointment, start + 15).window).toBe(
            slotProgress(appointment, start + 15, stamp('08:47')).window,
        );
    });

    // Both halves of the label read in hours past the hour, not `105 min`.
    it('reads a long slot in hours and minutes', () => {
        const appointment = { ...at('chair', '11:00', 'checked_in'), durationMinutes: 90 };
        const seated = minutesOfDay(stamp('11:00'));

        expect(slotProgress(appointment, seated + 45, stamp('11:00')).label).toBe('45:00 / 1h 30m');
        expect(slotProgress(appointment, seated + 75, stamp('11:00')).label).toBe('1:15:00 / 1h 30m');
        expect(slotProgress(appointment, seated + 153, stamp('11:00')).label).toBe('1:03:00 over');
    });

    // The counter skipped seconds on the device, and the timer was not why.
    // `nowMinutes` carries a fraction of a minute, and converting it back with
    // `* 60` lands just under the integer in binary — `(587 + 23/60 - 560) * 60`
    // is 1642.9999999999995, whose floor is a second nobody ever sees. Over ten
    // minutes of counting it swallowed 160 of them.
    it('never skips a second, over a run long enough to catch the float', () => {
        const appointment = at('chair', '11:00', 'checked_in');
        const seated = stamp('10:47', 23);
        const from = secondsOfDay(seated);

        for (let second = 0; second <= 600; second += 1) {
            const nowMinutes = (from + second) / 60;
            expect(slotProgress(appointment, nowMinutes, seated).count).toBe(formatElapsed(second));
        }
    });

    // The same bug from the other side: every step is exactly one second, so a
    // run of labels has no duplicates and no gaps either.
    it('advances by exactly one second per second', () => {
        const appointment = at('chair', '11:00', 'checked_in');
        const seated = stamp('10:47', 23);
        const from = secondsOfDay(seated);

        const counts = Array.from(
            { length: 300 },
            (_, second) => slotProgress(appointment, (from + second) / 60, seated).count,
        );

        expect(new Set(counts).size).toBe(counts.length);
    });

    // `minutesOfDay` truncates, which is right for placing a row on a schedule
    // and wrong for the stamp a stopwatch starts from: seated at :23 and read
    // half a minute later, the count used to say a full minute had gone.
    it('counts from the second the patient was seated, not the minute', () => {
        const appointment = at('chair', '11:00', 'checked_in');
        const seated = stamp('10:47', 30);

        expect(slotProgress(appointment, (secondsOfDay(seated) + 30) / 60, seated).count).toBe('0:30');
        expect(slotProgress(appointment, secondsOfDay(seated) / 60, seated).count).toBe('0:00');
    });

    // The label is split so only the half that changes has to be redrawn — and
    // rejoining the two has to give back exactly what the strip draws.
    it('splits the count from what it is counted against', () => {
        const appointment = at('chair', '11:00', 'checked_in');
        const seated = stamp('11:00');
        const from = secondsOfDay(seated);

        const running = slotProgress(appointment, (from + 900) / 60, seated);
        expect(running.count).toBe('15:00');
        expect(running.of).toBe('/ 30 min');
        expect(running.label).toBe(`${running.count} ${running.of}`);

        const late = slotProgress(appointment, (from + 2700) / 60, seated);
        expect(late.count).toBe('15:00');
        expect(late.of).toBe('over');
        expect(late.label).toBe('15:00 over');
    });
});

describe('the month', () => {
    const at = (id: string, branchId: string, status: AppointmentStatus = 'booked'): Appointment =>
        ({
            id,
            branchId,
            startsAt: `2026-08-10T11:00:00+03:00`,
            status,
            durationMinutes: 30,
            patient: { id: `p-${id}`, name: id, phone: '' },
        }) as Appointment;

    it('sends the day to the branch holding most of it', () => {
        const rows = [at('a', 'maadi'), at('b', 'zamalek'), at('c', 'zamalek')];
        expect(busiestBranch(rows, 'maadi')).toBe('zamalek');
    });

    it('stays where it is when the day is split evenly', () => {
        const rows = [at('a', 'zamalek'), at('b', 'maadi')];
        expect(busiestBranch(rows, 'maadi')).toBe('maadi');
        expect(busiestBranch(rows, 'zamalek')).toBe('zamalek');
    });

    it('moves nothing on a day with nothing booked', () => {
        expect(busiestBranch([], 'maadi')).toBe(null);
    });

    it('counts every branch, and lets no cancellation pull the pick', () => {
        const loads = loadsFrom(
            [SATURDAY],
            [[at('a', 'maadi'), at('b', 'zamalek'), at('c', 'zamalek', 'cancelled')]],
            undefined,
            'maadi',
        );

        expect(loads.get(SATURDAY)?.count).toBe(2);
        expect(loads.get(SATURDAY)?.busiest).toBe('maadi');
    });

    it('still counts a day that has been worked through', () => {
        // Checkout frees the slot for rebooking, but the day was still full —
        // so the bar has to survive it. Counting only the live statuses left
        // every past month drawing empty once its days had been worked.
        const loads = loadsFrom(
            [SATURDAY],
            [[at('a', 'maadi', 'done'), at('b', 'maadi', 'awaiting_payment'), at('c', 'maadi', 'no_show')]],
            undefined,
            'maadi',
        );

        expect(loads.get(SATURDAY)?.count).toBe(2);
        expect(loads.get(SATURDAY)?.busiest).toBe('maadi');
    });

    it('leaves a closed day at no load rather than dividing by nothing', () => {
        const loads = loadsFrom([FRIDAY], [[at('a', 'maadi')]], undefined, 'maadi');
        expect(loads.get(FRIDAY)?.fill).toBe(0);
        expect(loads.get(FRIDAY)?.slots).toBe(0);
    });
});

describe('errors', () => {
    it('says the slot is taken, and says what to do about it', () => {
        const overlap = new RequestError(ERROR_CODE.SLOT_OVERLAP, 'that slot overlaps another appointment');

        const walkIn = describeError(overlap, 'walk-in');
        expect(walkIn.title).toBe('That slot is taken');
        expect(walkIn.body).toContain('shorter visit');

        expect(describeError(overlap, 'move').title).toBe('That slot is taken');
    });

    it('names the clinic server when the request never arrived', () => {
        const offline = new RequestError(ERROR_CODE.INTERNAL, 'fetch failed', { offline: true });
        expect(describeError(offline, 'check-in').body).toContain('Nothing was saved');
    });
});

describe('an empty day', () => {
    it('offers the booking the desk can actually make', () => {
        const desk = emptyDay(false, true);
        expect(desk.actionLabel).toBe('Book someone in');
        expect(desk.glyph).toBe('calendar');
    });

    it('offers the doctor nothing, and does not tell them to book', () => {
        const doctor = emptyDay(false, false);
        expect(doctor.actionLabel).toBeUndefined();
        expect(doctor.body).not.toContain('Book someone in');
        expect(doctor.body).not.toContain('walk-in');
    });

    it('states a past day rather than inviting one, and drops the ring with the offer', () => {
        const past = emptyDay(true, true);
        expect(past.title).toBe('Nothing happened this day');
        expect(past.actionLabel).toBeUndefined();
        expect(past.glyph).toBe('none');
    });

    // A past day is a fact whoever booked it can no longer change, so it reads
    // the same to the desk and to the doctor.
    it('says the same thing about a past day to both screens', () => {
        expect(emptyDay(true, false)).toEqual(emptyDay(true, true));
    });
});

describe('money', () => {
    it('formats piastres as whole pounds, grouped', () => {
        expect(formatMoney(260_000)).toBe('EGP 2,600');
        expect(formatMoney(0)).toBe('EGP 0');
        // §7.13 — the symbol trails in Arabic, and it is the Arabic symbol that trails.
        expect(formatMoney(260_000, { language: 'ar' })).toBe('2,600 ج.م');
    });

    it('takes what has already been paid off the amount due', () => {
        expect(amountDue(260_000, 100_000)).toBe(160_000);
        expect(amountDue(260_000, 0)).toBe(260_000);
        expect(amountDue(50_000, 100_000)).toBe(0);
    });

    it('strips an amount where it is typed, not where it is parsed', () => {
        expect(poundsEntry('12.5')).toBe('125');
        expect(poundsEntry('1,200')).toBe('1200');
    });

    it('leaves the currency off a figure that already has one beside it', () => {
        expect(formatAmount(260_000)).toBe('2,600');
        expect(formatAmount(0)).toBe('0');
        expect(formatAmount(-90_000)).toBe('-900');
    });
});

describe('dates', () => {
    it('speaks in the days the secretary uses', () => {
        const today = dateKey(new Date());
        expect(relativeDayLabel(today, today)).toBe('Today');
        expect(relativeDayLabel(addDays(today, 1), today)).toBe('Tomorrow');
        expect(relativeDayLabel(addDays(today, -1), today)).toBe('Yesterday');
    });

    it('reads the 24-hour clock the server sends', () => {
        expect(clockToMinutes('09:05')).toBe(545);
    });

    // Formatting itself is `domain/clock`'s, and tested there. What this holds
    // is that the cluster still reaches it through `./time`.
    it('re-exports the twelve-hour clock', () => {
        expect(clock12(13 * 60)).toEqual({ time: '1:00', meridiem: 'PM' });
    });

    // The booking flow used to lowercase the meridiem at two call sites, so its
    // slots read "12:15 pm" against "12:15 PM" everywhere else. Asserted against
    // `clock12` rather than against 'PM': the meridiem is localized, and a
    // literal here would pass in Arabic however the casing drifted.
    it('says the time the way the formatter says it, not re-cased', () => {
        const { time, meridiem } = clock12(12 * 60 + 15);

        expect(timeLabel(12 * 60 + 15)).toBe(`${time} ${meridiem}`);
        expect(timeLabel(13 * 60)).toBe('1:00 PM');
        expect(timeLabel(10 * 60 + 30)).toBe('10:30 AM');
    });

    it('names the weekday in the header pill only when the day is not today', () => {
        const today = dateKey(new Date());
        expect(formatDatePill(today, today).split(' ')).toHaveLength(2);
        expect(formatDatePill(addDays(today, 2), today).split(' ')).toHaveLength(3);
        expect(formatDatePill(today, today)).toBe(formatDatePill(today, today).toUpperCase());
    });

    it('spells the day out in full on the visit screens', () => {
        expect(formatLongDate('2026-06-11')).toBe('Thursday, 11 June 2026');
        expect(formatLongDate('2026-01-01')).toBe('Thursday, 1 January 2026');
    });
});

describe('a patient who is new here', () => {
    const TODAY = '2026-08-16';

    it('draws the separators around the digits typed so far', () => {
        expect(birthDateDisplay('')).toBe('');
        expect(birthDateDisplay('05')).toBe('05');
        expect(birthDateDisplay('0511')).toBe('05 / 11');
        expect(birthDateDisplay('05111990')).toBe('05 / 11 / 1990');
    });

    it('keeps only digits, and only eight of them', () => {
        expect(birthDateDigits('05 / 11 / 1990')).toBe('05111990');
        expect(birthDateDigits('0511199012')).toBe('05111990');
        expect(birthDateDigits('abc')).toBe('');
    });

    it('turns a day-first entry into the ISO date the server takes', () => {
        expect(birthDateIso('05111990', TODAY)).toBe('1990-11-05');
        expect(birthDateIso('29022024', TODAY)).toBe('2024-02-29');
    });

    it('refuses a date nobody was born on', () => {
        expect(birthDateIso('29022023', TODAY)).toBeNull();
        expect(birthDateIso('32011990', TODAY)).toBeNull();
        expect(birthDateIso('05131990', TODAY)).toBeNull();
        expect(birthDateIso('05111899', TODAY)).toBeNull();
    });

    it('refuses a birth date in the future, however plausible', () => {
        expect(birthDateIso('17082026', TODAY)).toBeNull();
        expect(birthDateIso('16082026', TODAY)).toBe('2026-08-16');
    });

    // An entry in progress is not yet wrong — the error would fire on the first
    // keystroke and stay up until the last.
    it('says nothing about an empty field, and asks for the rest of a half-typed one', () => {
        expect(birthDateError('', TODAY)).toBeNull();
        expect(birthDateError('0511', TODAY)).not.toBeNull();
        expect(birthDateError('05111990', TODAY)).toBeNull();
    });

    it('catches the obvious in an address and leaves a blank one alone', () => {
        expect(emailError('')).toBeNull();
        expect(emailError('  ')).toBeNull();
        expect(emailError('nadia@example.com')).toBeNull();
        expect(emailError('nadia@example')).not.toBeNull();
        expect(emailError('nadia.example.com')).not.toBeNull();
    });

    it('books on a name and a number alone', () => {
        const ref = patientRefOf({
            ...EMPTY_PATIENT_DRAFT,
            mode: 'new',
            name: 'Nadia',
            phone: '01012345678',
        });
        expect(ref).toEqual({
            kind: 'new',
            name: 'Nadia',
            phone: '01012345678',
            email: null,
            birthDate: null,
            gender: null,
            notes: null,
        });
    });

    it('carries the details the desk did have', () => {
        const ref = patientRefOf({
            ...EMPTY_PATIENT_DRAFT,
            mode: 'new',
            name: '  Nadia  ',
            phone: '01012345678',
            email: 'nadia@example.com',
            birthDate: '05111990',
            gender: 'female',
            notes: 'Anxious about the drill.',
        });
        expect(ref).toEqual({
            kind: 'new',
            name: 'Nadia',
            phone: '01012345678',
            email: 'nadia@example.com',
            birthDate: '1990-11-05',
            gender: 'female',
            notes: 'Anxious about the drill.',
        });
    });

    // Sending it as blank would throw away what she was in the middle of writing.
    it('holds the booking while a detail is half-written', () => {
        const half = { ...EMPTY_PATIENT_DRAFT, mode: 'new' as const, name: 'Nadia', phone: '01012345678' };
        expect(patientRefOf({ ...half, birthDate: '0511' })).toBeNull();
        expect(patientRefOf({ ...half, email: 'nadia@' })).toBeNull();
    });
});

describe('booking slots', () => {
    const SCHEDULE = [{ weekday: 1, branchId: 'b', opensAt: '10:00', closesAt: '12:00' }];
    const MONDAY = '2026-08-10';

    // `isoAt` rather than a hand-written `+03:00`: `bun test` runs in UTC, and a
    // fixed offset would put 10:30 Cairo outside the clinic's morning there.
    const booked = (minutes: number, durationMinutes: number, status: AppointmentStatus): Appointment =>
        ({
            id: String(minutes),
            startsAt: isoAt(MONDAY, minutes),
            durationMinutes,
            status,
            branchId: 'b',
        }) as Appointment;

    const at = (slots: readonly Slot[], minutes: number) => slots.find((slot) => slot.minutes === minutes);

    it('steps the length of the visit from opening to closing', () => {
        const slots = slotsFor({
            dateKey: MONDAY,
            schedule: SCHEDULE,
            appointments: [],
            branchId: null,
            durationMinutes: 30,
            nowMinutes: null,
        });

        expect(slots.map((slot) => slot.minutes)).toEqual([600, 630, 660, 690]);
        expect(slots.every((slot) => slot.state === 'free')).toBe(true);
    });

    // A desk does not say "five fifty-three" to anyone. Offering the moment each
    // booking ends would squeeze a start into every gap at the cost of a grid
    // full of times nobody would agree to out loud. An overrunning day is real,
    // but it is absorbed by the day running late (`delay.ts`), not booked.
    it('stops at closing and keeps every time on the grid', () => {
        const slots = slotsFor({
            dateKey: MONDAY,
            schedule: SCHEDULE,
            // Seen at 11:00 for 23 minutes: out at 11:23, off any grid.
            appointments: [booked(660, 23, 'checked_in')],
            branchId: null,
            durationMinutes: 30,
            nowMinutes: null,
        });

        expect(slots.map((slot) => slot.minutes)).toEqual([600, 630, 660, 690]);
        expect(at(slots, 683)).toBeUndefined();
        expect(slots.every((slot) => slot.minutes < 720)).toBe(true);
    });

    it('still offers a time whose visit would end after closing, and says so', () => {
        const slots = slotsFor({
            dateKey: MONDAY,
            schedule: SCHEDULE,
            appointments: [],
            branchId: null,
            durationMinutes: 45,
            nowMinutes: null,
        });

        expect(at(slots, 690)?.state).toBe('free');
        expect(at(slots, 690)?.runsLate).toBe(true);
    });

    it('offers different times for different lengths', () => {
        const timesFor = (durationMinutes: number) =>
            slotsFor({
                dateKey: MONDAY,
                schedule: SCHEDULE,
                appointments: [],
                branchId: null,
                durationMinutes,
                nowMinutes: null,
            }).map((slot) => slot.minutes);

        expect(timesFor(20)).toEqual([600, 620, 640, 660, 680, 700]);
        expect(timesFor(45)).toEqual([600, 645, 690]);
    });

    // A clinic that runs Maadi on Thursday and Nasr City on Wednesday has no
    // clinic-wide hours: drawing the branch's grid out of another branch's day
    // offered a full Nasr City Thursday, then found no Nasr City bookings in it
    // and called every hour free.
    it('draws no grid for a branch that does not work that day', () => {
        const slots = slotsFor({
            dateKey: MONDAY,
            schedule: SCHEDULE,
            appointments: [],
            branchId: 'other',
            durationMinutes: 30,
            nowMinutes: null,
        });

        expect(slots).toHaveLength(0);
        expect(isClosed(MONDAY, SCHEDULE, 'other')).toBe(true);
        expect(isClosed(MONDAY, SCHEDULE, 'b')).toBe(false);
    });

    it('keeps the unscoped question clinic-wide, for the month grid', () => {
        expect(isClosed(MONDAY, SCHEDULE)).toBe(false);
        expect(openMinutes(MONDAY, SCHEDULE)).toBe(120);
    });

    it('offers a slot the visit would overrun closing on, and says so', () => {
        const slots = slotsFor({
            dateKey: MONDAY,
            schedule: SCHEDULE,
            appointments: [],
            branchId: null,
            durationMinutes: 45,
            nowMinutes: null,
        });

        expect(at(slots, 690)?.runsLate).toBe(true);
        expect(at(slots, 645)?.runsLate).toBe(false);
        expect(at(slots, 690)?.state).toBe('free');
    });

    it('takes every slot a booking overlaps, at either end', () => {
        const slots = slotsFor({
            dateKey: MONDAY,
            schedule: SCHEDULE,
            appointments: [booked(615, 30, 'booked')],
            branchId: null,
            durationMinutes: 30,
            nowMinutes: null,
        });

        // 10:15–10:45 is booked. A 30-minute visit at 10:00 runs into it, and so
        // does one at 10:30 — both ends. 11:00 is the first that clears it.
        expect(at(slots, 600)?.state).toBe('taken');
        expect(at(slots, 630)?.state).toBe('taken');
        expect(at(slots, 660)?.state).toBe('free');
    });

    it('frees the time a cancellation or a no-show was holding', () => {
        const slots = slotsFor({
            dateKey: MONDAY,
            schedule: SCHEDULE,
            appointments: [booked(630, 30, 'cancelled'), booked(660, 30, 'no_show')],
            branchId: null,
            durationMinutes: 15,
            nowMinutes: null,
        });

        expect(slots.every((slot) => slot.state === 'free')).toBe(true);
    });

    it('does not offer a time today that has already gone by', () => {
        const slots = slotsFor({
            dateKey: MONDAY,
            schedule: SCHEDULE,
            appointments: [],
            branchId: null,
            durationMinutes: 30,
            nowMinutes: 11 * 60,
        });

        expect(at(slots, 630)?.state).toBe('past');
        expect(at(slots, 660)?.state).toBe('free');
        expect(firstFreeSlot(slots)).toBe(660);
    });

    it('has no times at all on a closed day', () => {
        expect(
            slotsFor({
                dateKey: FRIDAY,
                schedule: undefined,
                appointments: [],
                branchId: null,
                durationMinutes: 30,
                nowMinutes: null,
            }),
        ).toEqual([]);
    });

    it('refuses a time that stopped being free while the sheet was open', () => {
        const slots = slotsFor({
            dateKey: MONDAY,
            schedule: SCHEDULE,
            appointments: [booked(630, 30, 'booked')],
            branchId: null,
            durationMinutes: 30,
            nowMinutes: null,
        });

        expect(slotIsFree(slots, 600)).toBe(true);
        expect(slotIsFree(slots, 630)).toBe(false);
        expect(slotIsFree(slots, null)).toBe(false);
    });
});

/**
 * The fortnight both booking flows offer — the full page and the book-next
 * sheet — so a day is only ever offered by one rule, and the sheet cannot come
 * to disagree with the page about which Thursday is still free.
 */
describe('the fortnight a booking is offered', () => {
    const SCHEDULE = [{ weekday: 1, branchId: 'b', opensAt: '10:00', closesAt: '12:00' }];
    const MONDAY = '2026-08-10';
    const NEXT_MONDAY = '2026-08-17';

    const booked = (day: string, minutes: number, branchId: string): Appointment =>
        ({
            id: `${day}:${minutes}`,
            startsAt: isoAt(day, minutes),
            durationMinutes: 30,
            status: 'booked' as AppointmentStatus,
            branchId,
        }) as Appointment;

    const fortnight = (fetched: readonly (readonly Appointment[])[] | undefined) =>
        fortnightSlots({
            days: [MONDAY, NEXT_MONDAY],
            fetched,
            schedule: SCHEDULE,
            branchId: 'b',
            durationMinutes: 30,
            today: MONDAY,
            nowMinutes: 0,
        });

    it('offers only the days the branch actually works', () => {
        expect(workingDaysIn(MONDAY, 14, SCHEDULE, 'b')).toEqual([MONDAY, NEXT_MONDAY]);
        expect(workingDaysIn(MONDAY, 14, SCHEDULE, 'other')).toEqual([]);
    });

    // `slotsFor([])` says every hour is free, so a day still being read must not
    // be treated as an empty one — that is how a grid offers a slot someone else
    // is already in.
    it('offers nothing at all until the rows are in hand', () => {
        const pending = fortnight(undefined);

        expect(pending.openDays).toEqual([]);
        expect(pending.slotsByDay.size).toBe(0);
    });

    it('takes a day off the strip once its last time has gone', () => {
        const full = [600, 630, 660, 690].map((minutes) => booked(MONDAY, minutes, 'b'));
        const { openDays, slotsByDay } = fortnight([full, []]);

        expect(openDays).toEqual([NEXT_MONDAY]);
        expect(slotsByDay.get(MONDAY)?.every((slot) => slot.state === 'taken')).toBe(true);
        expect(slotsByDay.get(NEXT_MONDAY)?.every((slot) => slot.state === 'free')).toBe(true);
    });

    it('leaves a time free when the booking on it belongs to another branch', () => {
        const { openDays, slotsByDay } = fortnight([[booked(MONDAY, 600, 'maadi')], []]);

        expect(openDays).toEqual([MONDAY, NEXT_MONDAY]);
        expect(slotsByDay.get(MONDAY)?.[0]?.state).toBe('free');
    });

    /**
     * A check-up six months out is an ordinary thing to ask for at the desk, and
     * the strip's window is not the limit on how far ahead the clinic can book —
     * a day past it is reached by name and joins the days offered, rather than
     * widening the window to a quarter of a year to reach one day of it.
     */
    describe('a day past the strip window', () => {
        const MARCH_MONDAY = '2027-03-01';

        it('joins the days offered, in date order', () => {
            expect(daysOffered(MONDAY, 14, MARCH_MONDAY, SCHEDULE, 'b')).toEqual([
                MONDAY,
                NEXT_MONDAY,
                MARCH_MONDAY,
            ]);
        });

        it('is the whole list when the window itself has no working day', () => {
            expect(daysOffered(MONDAY, 14, MARCH_MONDAY, SCHEDULE, 'other')).toEqual([]);
            expect(daysOffered(MONDAY, 14, null, SCHEDULE, 'b')).toEqual([MONDAY, NEXT_MONDAY]);
        });

        it('is not offered on a day the branch is shut', () => {
            // A Sunday: the schedule only has weekday 1.
            expect(daysOffered(MONDAY, 14, '2027-03-07', SCHEDULE, 'b')).toEqual([MONDAY, NEXT_MONDAY]);
        });

        it('does not double up a day the window already covers', () => {
            expect(daysOffered(MONDAY, 14, NEXT_MONDAY, SCHEDULE, 'b')).toEqual([MONDAY, NEXT_MONDAY]);
        });

        it('is ignored when it is in the past', () => {
            expect(daysOffered(MONDAY, 14, '2026-08-03', SCHEDULE, 'b')).toEqual([MONDAY, NEXT_MONDAY]);
        });
    });
});

/**
 * The book-next sheet asks and does not book. It used to carry its own day strip,
 * time grid and `appointment.create`, which made it a second booking flow, and
 * with it a second copy of the double-booking refusal. Both went: the prompt's
 * answer is `BookingScreen`, so that screen's refusal is the only one, and there
 * is no longer a `book-next` surface for `describeError` to have an opinion on.
 */
describe('book-next after a check-in', () => {
    it('sends a refused time to the booking screen’s wording, not a sheet’s', () => {
        const overlap = new RequestError(ERROR_CODE.SLOT_OVERLAP, 'that slot overlaps another appointment');
        const booking = describeError(overlap, 'booking');

        expect(booking.title).toBe('That slot is taken');
        expect(booking.body).toContain('reloaded');
    });

    // The sheet's own wording sent the desk to a grid directly under the
    // message. There is no grid now, so nothing may still say there is one.
    it('no longer tells anyone the times above have been reloaded', () => {
        const overlap = new RequestError(ERROR_CODE.SLOT_OVERLAP, 'that slot overlaps another appointment');

        for (const context of ['walk-in', 'booking', 'move', 'check-in', 'day', 'generic'] as const) {
            expect(describeError(overlap, context).body).not.toContain('above');
        }
    });
});

describe('the procedure plan', () => {
    const line = (id: string, tooth: Tooth | null, price: number): PlannedProcedure => ({
        id,
        procedureId: `proc-${id}`,
        name: 'Composite filling',
        variant: 'Class II',
        tooth,
        price,
    });

    it('groups by tooth, in the order a chart is read, with no tooth last', () => {
        const groups = groupByTooth([
            line('a', 'LL4', 700_00),
            line('b', null, 400_00),
            line('c', 'UL6', 900_00),
            line('d', 'LL4', 300_00),
        ]);

        expect(groups.map((group) => group.tooth)).toEqual(['UL6', 'LL4', null]);
        expect(groups[1]?.items.map((item) => item.id)).toEqual(['a', 'd']);
        expect(groups[1]?.subtotal).toBe(1000_00);
    });

    it('names where a tooth is, and says so when there is none', () => {
        expect(toothPosition('UL6')).toBe('Upper left · 6');
        expect(toothPosition('LRE')).toBe('Lower right · E');
        expect(toothPosition(null)).toBe('No tooth assigned');
    });

    it('offers the child teeth after the permanent ones in every quadrant', () => {
        const upperRight = QUADRANTS.find((quadrant) => quadrant.key === 'UR');

        // Upper right counts towards the midline, so it starts at the wisdom tooth.
        expect(upperRight?.codes[0]).toBe('UR8');
        expect(upperRight?.codes[7]).toBe('UR1');
        expect(upperRight?.codes.slice(8)).toEqual(['URA', 'URB', 'URC', 'URD', 'URE']);
    });

    it('totals the plan', () => {
        expect(totalOf([line('a', 'UL6', 900_00), line('b', null, 400_00)])).toBe(1300_00);
        expect(totalOf([])).toBe(0);
    });

    // The price stays behind: the visit snapshots the catalogue's at check-in,
    // so what is booked is the work, never what it was quoted at.
    it('sends every line of the plan, with its tooth and without its price', () => {
        expect(bookedProcedures([line('a', 'UL6', 900_00), line('b', null, 400_00)])).toEqual([
            { procedureId: 'proc-a', tooth: 'UL6' },
            { procedureId: 'proc-b', tooth: null },
        ]);
        expect(bookedProcedures([])).toEqual([]);
    });

    it('keeps two of the same procedure as two lines rather than a quantity', () => {
        expect(bookedProcedures([line('a', 'UL6', 900_00), line('b', 'UL6', 900_00)])).toHaveLength(2);
    });

    it('reads a line back the way the note and the summary print it', () => {
        expect(describeProcedure(line('a', 'UL6', 0))).toBe('Composite filling · Class II (UL6)');
        expect(describeProcedure({ ...line('b', null, 0), variant: null })).toBe('Composite filling');
    });
});

/**
 * A clinic day slips for two reasons — the chair overruns, and walk-ins are
 * taken — and both push the booked day along. Nothing is written: the booked
 * time is what the patient was told, and the projection is what it means now.
 */
describe('a day running late', () => {
    const MONDAY = '2026-08-10';

    const row = (
        id: string,
        minutes: number,
        durationMinutes: number,
        status: AppointmentStatus,
        channel: 'desk' | 'walk_in' = 'desk',
    ): Appointment =>
        ({
            id,
            startsAt: isoAt(MONDAY, minutes),
            durationMinutes,
            status,
            channel,
            branchId: 'b',
            updatedAt: isoAt(MONDAY, minutes),
        }) as Appointment;

    it('is on time when the chair is inside its slot', () => {
        const delay = dayDelay([row('a', 600, 30, 'checked_in')], 615);

        expect(delay).toEqual(ON_TIME);
        expect(delayLabel(delay)).toBeNull();
    });

    // The overrun is counted to the minute and reported to the minute, but what
    // the day *slides* by is rounded up to a slot: "6:17" claims to know when
    // the chair empties, and a column of odd minutes is harder to read than a
    // column of clean ones while saying less.
    it('counts the overrun to the minute and slides by the slot', () => {
        // Seen at 10:00 for 30 minutes, and it is 10:42.
        const delay = dayDelay([row('a', 600, 30, 'checked_in')], 642);

        expect(delay.fromChair).toBe(12);
        expect(delay.minutes).toBe(15);
        // The headline is the overrun itself; only the slide is rounded.
        expect(delayLabel(delay)).toBe('12 min late');
    });

    // Taking the walk-in already moved the booked day: the server seated it at
    // 10:10 and pushed everyone it ran into past 10:30, so those 20 minutes are
    // inside their `startsAt` before this function ever sees them. Counting
    // them here too would put every projection below 20 minutes further out
    // than the day actually is.
    it('does not count a waiting walk-in, whose minutes are already in the layout', () => {
        const delay = dayDelay(
            [row('chair', 600, 30, 'checked_in'), row('walk', 610, 20, 'checked_in', 'walk_in')],
            615,
            new Map([
                ['chair', isoAt(MONDAY, 600)],
                ['walk', isoAt(MONDAY, 610)],
            ]),
        );

        expect(delay).toEqual(ON_TIME);
        expect(delayLabel(delay)).toBeNull();
    });

    it('slides by the chair alone when a walk-in is waiting behind it', () => {
        const delay = dayDelay(
            [row('chair', 600, 30, 'checked_in'), row('walk', 620, 20, 'checked_in', 'walk_in')],
            642,
            new Map([
                ['chair', isoAt(MONDAY, 600)],
                ['walk', isoAt(MONDAY, 620)],
            ]),
        );

        expect(delay.fromChair).toBe(12);
        expect(delay.minutes).toBe(15);
        expect(delayLabel(delay)).toBe('12 min late');
    });

    // The reviewer's case, as the desk sees it: the chair is on time and ends
    // at 12:30, the walk-in has 12:30–13:00, and the booked patient the server
    // already pushed reads 13:00. At 12:15 that 13:00 must not project to 13:30.
    it('leaves a pushed booking reading the time the server moved it to', () => {
        const appointments = [
            row('chair', 720, 30, 'checked_in'),
            row('walk', 750, 30, 'checked_in', 'walk_in'),
            row('booked', 780, 30, 'booked'),
        ];
        const delay = dayDelay(
            appointments,
            735,
            new Map([
                ['chair', isoAt(MONDAY, 720)],
                ['walk', isoAt(MONDAY, 750)],
            ]),
        );

        expect(delay.minutes).toBe(0);
        expect(projectedStart(appointments[2] as Appointment, delay, 735)).toBe(780);
    });

    // A booked patient waiting their turn already owns a slot further down the
    // day. Counting them would count that time twice.
    it('does not count a booked patient who is merely waiting', () => {
        const delay = dayDelay(
            [row('chair', 600, 30, 'checked_in'), row('early', 610, 30, 'checked_in')],
            615,
            new Map([
                ['chair', isoAt(MONDAY, 600)],
                ['early', isoAt(MONDAY, 610)],
            ]),
        );

        expect(delay.minutes).toBe(0);
    });

    it('slides every booked time by the delay, and leaves history alone', () => {
        const delay = dayDelay([row('chair', 600, 30, 'checked_in')], 642);
        const later = row('later', 720, 30, 'booked');
        const done = row('done', 540, 30, 'done');

        // Booked 12:00, the day is 15 minutes behind: 12:15, on the grid.
        expect(projectedStart(later, delay, 642)).toBe(735);
        expect(isProjected(later, delay)).toBe(true);

        expect(projectedStart(done, delay, 642)).toBe(540);
        expect(isProjected(done, delay)).toBe(false);
    });

    it('never projects a time into the past', () => {
        const delay = dayDelay([row('chair', 600, 30, 'checked_in')], 700);
        // Booked 10:15, delay is 70 minutes, so the projection lands at 11:25 —
        // but it is 11:40 and they have not been seen, so they are next, not late.
        expect(projectedStart(row('missed', 615, 30, 'booked'), delay, 700)).toBe(700);
    });

    it('keeps every projection on the slot grid, whatever the odd minute', () => {
        // 10:00 for 30 minutes, and it is 10:37: seven minutes over, so the day
        // slides by ten and nothing lands on a 6:17.
        const delay = dayDelay([row('chair', 600, 30, 'checked_in')], 637);

        expect(delay.minutes).toBe(10);
        expect(
            [720, 750, 780].map((minutes) => projectedStart(row('x', minutes, 30, 'booked'), delay, 637)),
        ).toEqual([730, 760, 790]);
    });

    it('cannot be late on a day the clock has not reached', () => {
        expect(dayDelay([row('chair', 600, 30, 'checked_in')], null)).toEqual(ON_TIME);
    });
});

describe('the checkup the arrival screen shows', () => {
    const tree = (): ProcedureCategory[] =>
        [
            {
                id: 'checkup',
                name: 'Consultation',
                defaultPrice: 30_000,
                isCheckup: true,
                selectable: true,
                children: [],
            },
            {
                id: 'filling',
                name: 'Composite filling',
                defaultPrice: 0,
                isCheckup: false,
                selectable: false,
                children: [{ id: 'class-i', name: 'Class I', defaultPrice: 70_000, isCheckup: false }],
            },
        ] as unknown as ProcedureCategory[];

    it('adds the clinic checkup to a plan that has none', () => {
        expect(checkupToAdd(tree(), [{ procedureId: 'class-i' }])).toEqual({
            procedureId: 'checkup',
            name: 'Consultation',
            price: 30_000,
        });
    });

    it('waives it when the booking already asked for one, as check-in does', () => {
        expect(checkupToAdd(tree(), [{ procedureId: 'checkup' }])).toBeNull();
    });

    it('adds nothing when the clinic has no checkup set up', () => {
        const none = tree().filter((row) => !row.isCheckup);
        expect(checkupToAdd(none, [])).toBeNull();
    });
});

describe('what the catalogue offers', () => {
    const category = (
        id: string,
        isToothSpecific: boolean,
        children: { id: string; isToothSpecific: boolean }[] = [],
    ) =>
        ({
            id,
            name: id,
            parentId: null,
            defaultPrice: 0,
            hasQuantity: false,
            isToothSpecific,
            isCheckup: false,
            active: true,
            sortOrder: 0,
            selectable: children.length === 0,
            children: children.map((child) => ({
                ...child,
                name: child.id,
                parentId: id,
                defaultPrice: 0,
                hasQuantity: false,
                isCheckup: false,
                active: true,
                sortOrder: 0,
            })),
        }) as ProcedureCategory;

    // A tooth was named, so mouth-level work cannot go on it — the server
    // refuses that pairing, and a plan built here but not bookable is a dead end
    // found at the confirm step with a patient waiting.
    it('offers only tooth work once a tooth is chosen', () => {
        const offered = offeredFor([category('extraction', true), category('scaling', false)], true);

        expect(offered.map((row) => row.id)).toEqual(['extraction']);
    });

    // The other direction is not symmetric: without a tooth the sheet is the
    // whole catalogue, and the tooth is asked for after the pick. Mirroring the
    // strict match here is what hid every uncategorised tooth-specific
    // procedure behind a button that just said "Add procedure".
    it('offers the whole catalogue when no tooth is assigned', () => {
        const offered = offeredFor([category('extraction', true), category('scaling', false)], false);

        expect(offered.map((row) => row.id)).toEqual(['extraction', 'scaling']);
    });

    it('keeps a heading only for the variants that fit', () => {
        const filling = category('filling', false, [
            { id: 'class-i', isToothSpecific: true },
            { id: 'whitening', isToothSpecific: false },
        ]);

        const offered = offeredFor([filling], true);

        expect(offered.map((row) => row.id)).toEqual(['filling']);
        expect(offered[0]?.children.map((child) => child.id)).toEqual(['class-i']);
    });

    it('drops a heading whose every variant is mouth work once a tooth is chosen', () => {
        const filling = category('filling', false, [{ id: 'whitening', isToothSpecific: false }]);

        expect(offeredFor([filling], true)).toEqual([]);
    });

    it('keeps every variant of a heading when no tooth is assigned', () => {
        const filling = category('filling', false, [
            { id: 'class-i', isToothSpecific: true },
            { id: 'whitening', isToothSpecific: false },
        ]);

        const offered = offeredFor([filling], false);

        expect(offered[0]?.children.map((child) => child.id)).toEqual(['class-i', 'whitening']);
    });
});
