/**
 * The day view — the screen the secretary has open all day. It answers three
 * questions in the design's order: what has already happened (folded away),
 * who is in the chair (the black card), and what is still to come. Two rules
 * run through it: every list has loading, error and empty states, and every
 * write reports what happened to it in place — the clinic PC is across
 * Tailscale, so silence is the one thing a write is never allowed to be. The
 * sheets are keyed/sequenced so each opening is a fresh draft and a
 * half-finished confirm cannot be inherited by the next patient. The day
 * banner distinguishes an unloaded schedule from an unconfigured one — both
 * fall back to the same default hours, but the second is the clinic's own
 * guess while the first is this screen's.
 */
import { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
    Banner,
    Button,
    PushView,
    RefreshView,
    SegmentedControl,
    Toast,
    useAfterSheet,
    usePullToRefresh,
} from '../../components/ui';
import { isOpen, rendered, useRouteStack } from '../../navigation';
import { border, color, radius, size, space, Text } from '../../theme';
import { procedureLabel, splitDay } from './agenda';
import { CALENDAR_CLOSED, type CalendarState, closeCalendar, openCalendar } from './calendar';
import { type Standing, splitDeskDay } from './chair';
import { BeforeThis, UpNext } from './components/Agenda';
import { AppointmentDetailSheet } from './components/AppointmentDetailSheet';
import { BookFab } from './components/BookFab';
import { BookingScreen } from './components/BookingScreen';
import { BookNextSheet } from './components/BookNextSheet';
import { BookPatientSheet } from './components/BookPatientSheet';
import { CalendarSheet } from './components/CalendarSheet';
import { ClosedDay } from './components/ClosedDay';
import { DayHeader } from './components/DayHeader';
import { DayEmpty, DayError, DaySkeleton } from './components/DayStates';
import { ChatIcon, ClockIcon, CloseIcon } from './components/icons';
import { NowCard } from './components/NowCard';
import { Reminders } from './components/Reminders';
import { VisitPaymentScreen } from './components/VisitPaymentScreen';
import { VisitScreen } from './components/VisitScreen';
import { VisitViewScreen } from './components/VisitViewScreen';
import {
    type Appointment,
    api,
    checkInTimes,
    type EmbeddedPatient,
    type Patient,
    useLocalMutation,
    useLocalQuery,
    type Visit,
    visitForAppointment,
} from './data';
import { dayDelay, delayLabel } from './delay';
import { describeError } from './errors';
import { isClosed } from './hours';
import { busiestBranch, holdsSlot } from './month';
import { draftFor, type PatientDraft } from './patientDraft';
import { relativeDayLabel, todayKey } from './time';
import { useNowMinutes } from './useNow';

type DayTab = 'day' | 'reminders';

/**
 * The pages that stack over the schedule. The three visit pages carry no data:
 * what they are about is one visit held beside the stack, because Confirm
 * reprices it while the treatment page is still underneath and an entry holding
 * its own copy would have the stale one to come back to.
 *
 * `view` is the read-only page a finished visit opens on. Its being there is
 * what used to be `origin === 'view'`, checked in two places to work out where
 * Back went — the stack answers that now by having it underneath, or not.
 */
type Route =
    | {
          name: 'booking';
          patient: PatientDraft;
          /** Set only when the booking was asked for from outside, which says which button it was. */
          timing?: 'now' | 'later';
      }
    | { name: 'view' }
    | { name: 'treatment' }
    | { name: 'payment' };

/**
 * A booking asked for from outside this cluster — the patient record's Book and
 * Walk-in, routed here by the shell because a cluster cannot push into another
 * one's stack. It skips `BookPatientSheet`, whose only question is already
 * answered, and opens `BookingScreen` on the patient it names. `timing` is the
 * difference between the two buttons: a walk-in is the "now" answer to when.
 * `seq` makes each ask distinct, so the same patient can be booked twice.
 */
export type OpenBookingRequest = {
    patient: Patient;
    timing: 'now' | 'later';
    seq: number;
};

export type DayScreenProps = {
    /** The booking page covers the day pane; the shell lights the Patients tab
     * while it is up, because a booking belongs to the patient, not to today. */
    onBookingChange?: (open: boolean) => void;
    /**
     * Open a patient's record. The shell owns the route because the record
     * lives on the Patients tab, and the tab bar has to move with it — and it
     * carries `said` for the same reason: a toast raised here would draw inside
     * a pane the shell is about to hide. `backLabel` names where the record was
     * opened from, which is not always the day: a tap in the Reminders tab has
     * to come back to Reminders, not to the day behind it.
     */
    onOpenRecord?: (patientId: string, said?: string, backLabel?: string) => void;
    /** A booking pushed in from another cluster — the patient record's two openers. */
    open?: OpenBookingRequest;
    /**
     * Bumped by the shell when the Day tab is tapped while it is already up.
     * Home is the schedule: whatever is pushed over it closes, and the date and
     * branch stay where they were — they are what the desk chose, not a route.
     */
    goHome?: number;
};

function DayScreenView({ onBookingChange, onOpenRecord, open, goHome = 0 }: DayScreenProps = {}) {
    const [dateKey, setDateKey] = useState(todayKey);
    const [tab, setTab] = useState<DayTab>('day');
    const [branchId, setBranchId] = useState<string | null>(null);
    const [calendar, setCalendar] = useState<CalendarState>(CALENDAR_CLOSED);
    const [booking, setBooking] = useState({ open: false, seq: 0 });
    const [seenOpen, setSeenOpen] = useState(0);
    const [seenHome, setSeenHome] = useState(goHome);
    const [selected, setSelected] = useState<{ appointment: Appointment | null; open: boolean }>({
        appointment: null,
        open: false,
    });
    /**
     * What the visit pages are about, which is one visit however many pages are
     * stacked on it. The pages themselves are routes; this is the subject they
     * share, and it is deliberately not on the stack — Confirm reprices the
     * visit while the treatment page is still underneath, and an entry holding
     * its own copy would have the stale one to come back to.
     *
     * Never cleared, only replaced. It has to outlive the last page's exit
     * animation, and the next `openVisit` is what makes it wrong to keep.
     */
    const [visit, setVisit] = useState<{
        appointment: Appointment;
        /** Absent on an arrival — Confirm is what creates it. */
        visit: Visit | null;
        /**
         * Why the flow was opened. It decides what the editor's bar offers: an
         * arrival confirms into the waiting room and a checkout goes on to the
         * money. Where Back goes is the stack's answer now, not this one's — a
         * finished visit was opened on the read-only page, so the page is there
         * to return to.
         */
        origin: 'view' | 'arrival' | 'checkout';
        /**
         * Where the patient was standing when the flow opened — the queue's
         * answer, which the status cannot give: the chair and the three people
         * behind it are all `checked_in`.
         */
        standing: Standing | null;
        seq: number;
    } | null>(null);
    // The book-next offer, raised by a check-in and by nothing else. `seated` is
    // captured when it opens rather than read when it closes: it describes the
    // queue at the moment the patient came through the door, and the refetch
    // underneath the sheet will have moved on by the time anything is booked.
    const [bookNext, setBookNext] = useState<{
        patient: EmbeddedPatient;
        seated: string;
        seq: number;
    } | null>(null);
    const [bookNextOpen, setBookNextOpen] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    // Every exit from these two sheets goes somewhere else — the record, the
    // booking page, the visit pages — and none of them may draw until the sheet
    // that asked has finished leaving.
    const bookNextDone = useAfterSheet();
    const detailDone = useAfterSheet();

    /**
     * The pages over the schedule, and the hardware back with them: back is
     * `pop`, which is the same function every page's own Back calls.
     *
     * The sheets are not on it. Each swallows back for itself while it is up
     * (`ui/Sheet`), and none of them is ever underneath one of these pages.
     *
     * The schedule is the root, so a press with nothing pushed goes on to the
     * shell — which on the day tab means leaving the app.
     */
    const routes = useRouteStack<Route>();

    // Both derived during render rather than in an effect, so the page is on
    // screen in the same commit as the tab switch and the pane never paints the
    // schedule for a frame first.
    if (open && open.seq !== seenOpen) {
        setSeenOpen(open.seq);
        setBooking((current) => ({ ...current, open: false }));
        routes.resetTo({ name: 'booking', patient: draftFor(open.patient), timing: open.timing });
    }

    // Everything pushed over the schedule comes down. The shell drops the
    // booking highlight itself — it is what raised it — so nothing is reported
    // back up from inside a render.
    if (goHome !== seenHome) {
        setSeenHome(goHome);
        setTab('day');
        routes.popToRoot();
        setBookNextOpen(false);
        setBooking((current) => ({ ...current, open: false }));
        setCalendar(closeCalendar);
        setSelected((current) => ({ ...current, open: false }));
    }

    /**
     * The two route changes that discard a pane instead of letting it leave.
     * `push` drops whatever was mid-slide and `resetTo` drops that and what is
     * open with it (`navigation/routeStack.ts`), and a pane that goes that way
     * never reaches `PushView`'s `onClosed` — so the one line that reports a
     * booking gone never runs, and the tab stays lit on Patients with no
     * booking on screen. These say it instead, and say it as what is drawn
     * after the change rather than as what left, which is the same answer
     * whether anything was discarded or not.
     *
     * Not for the two changes above: those run during render, where the shell
     * cannot be told anything — and it is the shell that raises and drops the
     * highlight for both of them anyway.
     */
    function pushPage(route: Route) {
        routes.push(route);
        // A push keeps what is open, so a booking under the arriving page is
        // still drawn and still counts.
        const under = routes.stack.open.some((entry) => entry.route.name === 'booking');
        onBookingChange?.(route.name === 'booking' || under);
    }

    function resetToPage(route: Route) {
        routes.resetTo(route);
        // A reset leaves nothing of what there was, open or leaving.
        onBookingChange?.(route.name === 'booking');
    }

    const nowMinutes = useNowMinutes();

    const schedule = useLocalQuery('schedule', api.schedule);
    const settings = useLocalQuery('settings', api.settings);
    const branches = useLocalQuery('branches', api.branches);
    // The day is fetched for the whole clinic and split here, so the screen can
    // open on the branch holding most of it: `branches[0]` drew an empty Maadi
    // while Nasr City had the day, and the emptiness read as a broken fetch. A
    // branch the user picked wins over the count, and holds until they pick
    // another.
    const day = useLocalQuery(`day:${dateKey}`, () => api.byDate(dateKey));
    const clinicDay = day.data ?? [];
    const branch =
        branchId ?? busiestBranch(clinicDay.filter(holdsSlot), null) ?? branches.data?.[0]?.id ?? null;

    const reminders = useLocalQuery('reminders', () => api.pendingReminders(todayKey()));
    const reminderCount = reminders.data?.length ?? 0;

    // Tapping a row that already has a visit. Separate from `loadVisit` so a
    // tap during a check-in is not swallowed by the other one's in-flight guard.
    const openRow = useLocalMutation(visitForAppointment);
    const noShow = useLocalMutation(api.markNoShow);

    const appointments = clinicDay.filter((row) => row.branchId === branch);
    const closed = isClosed(dateKey, schedule.data, branch);

    // An empty branch on a day the clinic is working says so, and offers the
    // branch working it — the same fetch already has the rows, and "Nothing
    // booked" over a full Nasr City is the thing that reads as a broken app.
    const away = clinicDay.filter((row) => row.branchId !== branch && holdsSlot(row));
    const awayId = busiestBranch(away, null);
    const awayName = (branches.data ?? []).find((row) => row.id === awayId)?.name;
    const elsewhere =
        awayId && awayName
            ? {
                  name: awayName,
                  count: away.filter((row) => row.branchId === awayId).length,
                  onGo: () => setBranchId(awayId),
              }
            : undefined;
    const isToday = dateKey === todayKey();

    const checkedInIds = useMemo(
        () =>
            appointments
                .filter((row) => row.status === 'checked_in')
                .map((row) => row.id)
                .sort(),
        [appointments],
    );
    const arrivals = useLocalQuery(`arrivals:${checkedInIds.join(',')}`, () => checkInTimes(checkedInIds), {
        enabled: checkedInIds.length > 0,
    });

    // Where the chair's bar counts from. `in_chair_at` is the answer; a visit
    // recorded before that column existed has none, and the check-in is the
    // closest thing to it — wrong only for someone who queued, which is exactly
    // the case the column was added for.
    const seatFor = (id: string) => arrivals.data?.inChairAt.get(id) ?? arrivals.data?.checkedInAt.get(id);

    // A pull re-asks for this screen's five reads and nothing else. The other
    // tabs are mounted behind this one and refetching them from here would put
    // three screens' worth of traffic on the tunnel for a screen nobody is
    // looking at — `/ws` is what keeps those fresh. A failed refresh keeps the
    // day on screen behind its banner, so the gesture is safe on a bad signal.
    const reads = [day, schedule, branches, reminders, arrivals];
    const refreshControl = usePullToRefresh(
        () => {
            day.refetch();
            schedule.refetch();
            branches.refetch();
            reminders.refetch();
            if (checkedInIds.length > 0) arrivals.refetch();
        },
        reads.some((read) => read.refreshing || read.status === 'loading'),
    );

    // The chair is the queue's head, not whoever's slot the clock happens to be
    // inside — the doctor's screen reads it the same way, and picking by slot
    // was what had the two screens seating different patients.
    const { chair, waiting, desk, next, card } = useMemo(
        () => splitDeskDay(appointments, arrivals.data?.checkedInAt),
        [appointments, arrivals.data],
    );

    // Whoever the black card is about: money owed outranks the chair, so a
    // patient at the desk holds it until they have paid.
    const active = desk ?? chair;

    // Only today folds: "before this" is relative to now, and off today every
    // row is settled, so folding put the whole day behind a section this screen
    // draws on today alone — an empty body under a tab still counting the rows.
    const { past, upcoming } = splitDay(appointments, isToday ? (card?.id ?? null) : null, isToday);

    // What the chair's overrun and any walk-ins mean for everyone still to be
    // seen. Nothing is written — `startsAt` stays the time the patient was told
    // — and the projection unwinds by itself as the day catches up.
    const delay = useMemo(
        () => dayDelay(appointments, isToday ? nowMinutes : null, arrivals.data?.checkedInAt),
        [appointments, isToday, nowMinutes, arrivals.data],
    );

    // The desk can close the late banner once it has been read. It stays closed
    // for as long as the day is still running late, and comes back the next time
    // the day falls behind: dropped the moment the delay clears, adjusted during
    // render rather than in an effect.
    const lateText = delayLabel(delay);
    const [lateDismissed, setLateDismissed] = useState(false);
    if (lateDismissed && !lateText) setLateDismissed(false);

    // The calendar counts every branch, so a picked day carries the branch it
    // is busiest in; following it is what stops the grid promising a day the
    // day view then draws empty. A day with nothing booked carries no branch.
    const pickDay = (nextDate: string, nextBranch: string | null) => {
        setDateKey(nextDate);
        if (nextBranch) setBranchId(nextBranch);
    };

    const openBooking = () => setBooking((current) => ({ open: true, seq: current.seq + 1 }));

    /**
     * A row with a visit behind it is a way into that visit, not into a menu:
     * tapping the patient in the chair goes straight to what was done. The
     * sheet stays for everything else, which is where the booking-time actions
     * live (check in, cancel, no-show) and where a finished visit is read.
     * A visit that cannot be found falls back to the sheet rather than to
     * nothing — the row still has to open.
     */
    function openDetail(appointment: Appointment) {
        const live = appointment.status === 'checked_in' || appointment.status === 'awaiting_payment';
        // A finished visit opens read-only: it is history until someone says
        // otherwise, and `Edit visit` on that screen is what says otherwise.
        const finished = appointment.status === 'done';
        if (!live && !finished) {
            setSelected({ appointment, open: true });
            return;
        }

        openRow.mutate(appointment.id, {
            onSuccess: (loaded) => {
                if (loaded) {
                    openVisit(appointment, loaded, finished ? 'view' : 'checkout');
                    return;
                }
                setSelected({ appointment, open: true });
            },
        });
    }

    // Nothing to wait for: checking in opens a screen and writes nothing, so
    // no row is ever mid-check-in.
    const checkingInId = null;

    function openVisit(
        appointment: Appointment,
        loaded: Visit | null,
        origin: 'view' | 'arrival' | 'checkout' = 'checkout',
    ) {
        setVisit((current) => ({
            appointment,
            visit: loaded,
            origin,
            standing: standingOf(appointment),
            seq: (current?.seq ?? 0) + 1,
        }));
        // A finished visit opens on the read-only page and the editor pushes on
        // top of it; everything else starts on the editor with the schedule
        // underneath. That is the whole of what `origin === 'view'` decided.
        resetToPage(origin === 'view' ? { name: 'view' } : { name: 'treatment' });
    }

    /**
     * The queue decides this, not the status. Everyone waiting to be seen is
     * `checked_in` and so is the patient in the chair; only the head of the
     * queue is in it, and only they can be sent on to the desk.
     */
    function standingOf(appointment: Appointment): Standing {
        // A finished visit stays finished through the edit that follows it —
        // reopening unlocks the visit and leaves the appointment alone. And a
        // day that is not today has no chair and no desk to speak of.
        if (appointment.status === 'done' || !isToday) return 'finished';
        if (appointment.status === 'awaiting_payment') return 'desk';
        return chair?.id === appointment.id ? 'chair' : 'waiting';
    }

    /**
     * Where the patient stands once they are through the door, as a phrase
     * without their name: the toast that carries it lands on their record,
     * where the name is already the largest thing on the screen.
     */
    function seated(): string {
        // Checking in no longer means going in: with the chair taken they join
        // the queue, and the message has to say which happened.
        return chair ? `waiting, ${waiting.length + 1} ahead` : 'in the chair';
    }

    /**
     * Where a check-in ends up: the patient's record, with what just happened
     * raised by the shell, because a toast raised here would draw inside a pane
     * the shell is about to hide. It is two lines, not one — the record already
     * has the patient's name as the largest thing on it, and the day view, which
     * has no record to open, has to say who it is talking about.
     *
     * The move waits for the sheet to be off the screen (`useAfterSheet`). The
     * record is the heavier of the two answers to mount — a pane swap and a
     * query — so doing it in this tick is what left the sheet sitting over the
     * day view with nothing appearing to have happened.
     */
    function landOnRecord(patient: EmbeddedPatient, onRecord: string, onDay: string) {
        setBookNextOpen(false);
        bookNextDone.after(() => {
            if (onOpenRecord) {
                onOpenRecord(patient.id, onRecord);
                return;
            }
            setToast(onDay);
        });
    }

    /**
     * The other answer to the book-next prompt: the real booking flow, with the
     * patient already answered. The same page the FAB pushes, so there is one
     * booking screen and not a second one living in a sheet — what the sheet
     * saved was the search, and carrying the patient across is what saves it.
     *
     * `later` rather than `now`: they are being seen today, so the return is a
     * day yet to be chosen. Backing out of the page lands on the day, which is
     * where the check-in happened — `onBack` is the same one the FAB's booking
     * uses, so there is nothing extra to unwind.
     */
    function bookNextOn(patient: EmbeddedPatient) {
        setBookNextOpen(false);
        bookNextDone.after(() => {
            pushPage({ name: 'booking', patient: draftFor(patient), timing: 'later' });
        });
    }

    /**
     * Nothing is written here. The arrival screen opens on what the booking
     * planned and its Confirm is what checks the patient in — so a tap that
     * turns out to be the wrong row costs nothing, and the day never shows
     * someone as arrived who was never confirmed.
     */
    function checkInFrom(appointment: Appointment) {
        openVisit(appointment, null, 'arrival');
    }

    function markNoShow(appointment: Appointment) {
        noShow.mutate(appointment.id, {
            onSuccess: () => {
                setToast(`${appointment.patient.name} marked as a no-show`);
                day.refetch();
            },
        });
    }

    return (
        <View style={styles.screen}>
            <DayHeader
                dateKey={dateKey}
                branches={branches.data ?? []}
                branchId={branch}
                onPickBranch={setBranchId}
                onOpenCalendar={() => setCalendar(openCalendar)}
            />

            {reminderCount > 0 || tab === 'reminders' ? (
                <View style={styles.tabs}>
                    <SegmentedControl<DayTab>
                        accessibilityLabel="Day or reminders"
                        value={tab}
                        onChange={setTab}
                        segments={[
                            {
                                // The day being shown, not today: the pill sat
                                // on "Today" while the screen was on 18 Aug.
                                value: 'day',
                                label: `${relativeDayLabel(dateKey)} · ${appointments.length}`,
                                icon: (selected) => (
                                    <ClockIcon size={15} stroke={selected ? color.ink : color.ink2} />
                                ),
                            },
                            {
                                value: 'reminders',
                                label: `Reminders · ${reminderCount}`,
                                icon: (selected) => (
                                    <ChatIcon size={15} stroke={selected ? color.ink : color.ink2} />
                                ),
                            },
                        ]}
                    />
                </View>
            ) : null}

            {day.status === 'error' && day.error && appointments.length > 0 ? (
                <Banner
                    tone="offline"
                    live
                    message={`${describeError(day.error, 'day').title} — showing the day as it was.`}
                />
            ) : null}
            {schedule.error !== null && schedule.status !== 'success' ? (
                <Banner
                    tone="warning"
                    message="Opening hours could not be loaded — showing the usual hours."
                    action={
                        <Button
                            label="Try again"
                            variant="text"
                            size="md"
                            onPress={schedule.refetch}
                            loading={schedule.status === 'loading'}
                        />
                    }
                />
            ) : null}
            {openRow.error ? (
                <Banner
                    tone="warning"
                    message={`${describeError(openRow.error).title} — the visit could not be opened.`}
                />
            ) : null}
            {noShow.error ? <Banner tone="warning" message={describeError(noShow.error).title} /> : null}

            <View style={styles.body}>
                {tab === 'reminders' ? (
                    <Reminders
                        query={reminders}
                        refreshControl={refreshControl}
                        onOpenRecord={
                            onOpenRecord && ((patientId) => onOpenRecord(patientId, undefined, 'Reminders'))
                        }
                    />
                ) : day.status === 'loading' ? (
                    <DaySkeleton />
                ) : day.status === 'error' && day.error && appointments.length === 0 ? (
                    <RefreshView refreshControl={refreshControl}>
                        <DayError error={day.error} onRetry={day.refetch} />
                    </RefreshView>
                ) : closed ? (
                    <ClosedDay
                        dateKey={dateKey}
                        appointments={appointments}
                        onSelect={openDetail}
                        refreshControl={refreshControl}
                    />
                ) : appointments.length === 0 ? (
                    <RefreshView refreshControl={refreshControl}>
                        <DayEmpty past={dateKey < todayKey()} elsewhere={elsewhere} />
                    </RefreshView>
                ) : (
                    <ScrollView
                        contentContainerStyle={styles.agenda}
                        showsVerticalScrollIndicator={false}
                        refreshControl={refreshControl}
                        testID="day-agenda"
                    >
                        {isToday ? <BeforeThis appointments={past} onSelect={openDetail} /> : null}

                        {lateText && !lateDismissed ? (
                            <View style={styles.late}>
                                <ClockIcon size={13} stroke={color.due} />
                                <Text variant="footnote" weight="bold" tone="due" style={styles.lateText}>
                                    Running {lateText}
                                </Text>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Dismiss"
                                    hitSlop={space[3]}
                                    onPress={() => setLateDismissed(true)}
                                >
                                    <CloseIcon size={14} stroke={color.due} />
                                </Pressable>
                            </View>
                        ) : null}

                        {isToday ? (
                            <NowCard
                                active={active}
                                next={next}
                                nowMinutes={nowMinutes}
                                procedure={card ? procedureLabel(card) : undefined}
                                seatedAt={active ? seatFor(active.id) : undefined}
                                checkingInId={checkingInId}
                                onCheckIn={checkInFrom}
                                onOpen={openDetail}
                                onOpenRecord={(patientId) => onOpenRecord?.(patientId)}
                            />
                        ) : null}

                        <UpNext
                            appointments={upcoming}
                            chairId={isToday ? (chair?.id ?? null) : null}
                            delay={delay}
                            nowMinutes={isToday ? nowMinutes : null}
                            relativeToNow={isToday}
                            checkingInId={checkingInId}
                            onSelect={openDetail}
                            onCheckIn={checkInFrom}
                            onNoShow={markNoShow}
                        />
                    </ScrollView>
                )}
            </View>

            {tab === 'day' ? <BookFab onPress={openBooking} /> : null}

            <CalendarSheet
                key={`calendar:${calendar.seq}`}
                visible={calendar.open}
                selected={dateKey}
                schedule={schedule.data}
                branches={branches.data ?? []}
                branchId={branch}
                onPick={pickDay}
                onClose={() => setCalendar(closeCalendar)}
            />

            <BookPatientSheet
                key={`book-patient:${booking.seq}`}
                visible={booking.open}
                onClose={() => setBooking((current) => ({ ...current, open: false }))}
                onPicked={(patient) => {
                    setBooking((current) => ({ ...current, open: false }));
                    pushPage({ name: 'booking', patient });
                }}
            />

            <AppointmentDetailSheet
                key={`detail:${selected.appointment?.id ?? 'none'}`}
                visible={selected.open}
                appointment={selected.appointment}
                onClose={() => setSelected((current) => ({ ...current, open: false }))}
                onChanged={day.refetch}
                // The sheet closes itself on the way into a check-in, so this
                // only says what the page is; `onCheckOut` has to close it too.
                onCheckIn={(appointment) => detailDone.after(() => checkInFrom(appointment))}
                onCheckOut={(appointment, loaded) => {
                    setSelected((current) => ({ ...current, open: false }));
                    detailDone.after(() => openVisit(appointment, loaded));
                }}
                onClosed={detailDone.closed}
            />

            {/* Keyed per check-in, so one patient's answer is never the next
                patient's starting point. */}
            {bookNext ? (
                <BookNextSheet
                    key={`book-next:${bookNext.seq}`}
                    visible={bookNextOpen}
                    patientName={bookNext.patient.name}
                    onBookNow={() => bookNextOn(bookNext.patient)}
                    onDismiss={() =>
                        landOnRecord(
                            bookNext.patient,
                            `Checked in · ${bookNext.seated}`,
                            `${bookNext.patient.name} is ${bookNext.seated}`,
                        )
                    }
                    onClosed={bookNextDone.closed}
                />
            ) : null}

            {/* Siblings in stacking order rather than nested: each page still
                slides over the one before it and Back still slides it away with
                that one behind, scroll and all, because a `PushView` covers the
                whole pane and the later one paints on top. A ternary here drew
                both instantly, which is the missing transition it looked like.

                A popped page stays in this list until it reports the slide
                finished (`onClosed`); dropping it any earlier is what used to
                slide an empty pane off the screen. */}
            {rendered(routes.stack).map(({ id, route }, index) => (
                <PushView
                    key={id}
                    visible={isOpen(routes.stack, index)}
                    onClosed={() => {
                        routes.settled();
                        // The tab bar lights Patients while a booking is up,
                        // because a booking belongs to the patient it is for.
                        // Reported from here rather than from each way out, so
                        // the hardware back is covered by the same line as Back
                        // and Booked — whatever popped it, the page finishing
                        // its slide is the one moment they all share.
                        if (route.name === 'booking') onBookingChange?.(false);
                    }}
                    testID={`day-${route.name}-page`}
                >
                    {route.name === 'booking' ? (
                        <BookingScreen
                            patient={route.patient}
                            timing={route.timing}
                            branchId={branch}
                            branches={branches.data ?? []}
                            schedule={schedule.data}
                            durationOptions={settings.data?.durationOptions ?? [15, 30, 45]}
                            defaultDuration={settings.data?.defaultDuration ?? 30}
                            dateKey={dateKey}
                            nowMinutes={nowMinutes}
                            onBack={routes.pop}
                            onBooked={(message) => {
                                routes.pop();
                                setToast(message);
                                day.refetch();
                            }}
                        />
                    ) : null}

                    {route.name === 'view' && visit?.visit ? (
                        <VisitViewScreen
                            key={`view:${visit.seq}`}
                            appointment={visit.appointment}
                            visit={visit.visit}
                            onBack={routes.pop}
                            // The editor opens on the visit as it stands; the
                            // reopen it needs rides along with Confirm.
                            onEdit={() => pushPage({ name: 'treatment' })}
                        />
                    ) : null}

                    {route.name === 'treatment' && visit ? (
                        <VisitScreen
                            key={`visit:${visit.seq}`}
                            appointment={visit.appointment}
                            visit={visit.visit ?? undefined}
                            mode={visit.origin === 'arrival' ? 'arrival' : 'checkout'}
                            standing={visit.standing ?? undefined}
                            // Backing out of an arrival wrote nothing — they are
                            // still booked, and saying they are in the chair
                            // would be a lie. Where that lands is the stack's:
                            // the read-only page if this was opened over one,
                            // the schedule if it was not.
                            onBack={routes.pop}
                            onConfirm={(priced) => {
                                // An arrival is done here: they are in the chair
                                // or in the queue, and nothing is owed until the
                                // work is finished.
                                if (visit.origin === 'arrival') {
                                    routes.popToRoot();
                                    day.refetch();
                                    // The record still comes next — history,
                                    // balance, what to ask them — but the one
                                    // moment the patient is standing there is
                                    // the moment to offer them a return. The
                                    // sheet is offered, never imposed:
                                    // dismissing it lands exactly where
                                    // confirming an arrival always did.
                                    setBookNext((current) => ({
                                        patient: visit.appointment.patient,
                                        seated: seated(),
                                        seq: (current?.seq ?? 0) + 1,
                                    }));
                                    setBookNextOpen(true);
                                    return;
                                }
                                // Same for a patient still in the queue: this was
                                // their plan being corrected, and nothing is owed
                                // until the work is done.
                                if (visit.standing === 'waiting') {
                                    routes.popToRoot();
                                    setToast(`${visit.appointment.patient.name} is still waiting`);
                                    day.refetch();
                                    return;
                                }
                                setVisit({ ...visit, visit: priced });
                                pushPage({ name: 'payment' });
                            }}
                            onSentToDesk={(message) => {
                                routes.popToRoot();
                                setToast(message);
                                day.refetch();
                            }}
                        />
                    ) : null}

                    {route.name === 'payment' && visit?.visit ? (
                        <VisitPaymentScreen
                            key={`payment:${visit.seq}:${visit.visit.chargedTotal}`}
                            appointment={visit.appointment}
                            visit={visit.visit}
                            // Reopened from the read-only page: the money on it
                            // is being corrected, not collected for the first
                            // time.
                            correcting={visit.standing === 'finished'}
                            onBack={routes.pop}
                            onClosed={(message) => {
                                routes.popToRoot();
                                setToast(message);
                                day.refetch();
                            }}
                        />
                    ) : null}
                </PushView>
            ))}

            <Toast
                visible={toast !== null}
                message={toast ?? ''}
                onDismiss={() => setToast(null)}
                offset={space[6]}
            />
        </View>
    );
}

/**
 * The shell keeps all four tabs mounted, so anything that re-renders it renders
 * this tree too — a tab switch included, and this is the largest of the four.
 * The props the shell hands down are stable by design (`shell/AppShell.tsx`), so
 * memoising here is what makes a switch away from the day cost nothing.
 */
export const DayScreen = memo(DayScreenView);

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },
    body: { flex: 1 },
    agenda: { paddingBottom: size.nav, gap: space[3] },
    tabs: { paddingHorizontal: size.gutter, paddingBottom: space[3] },
    lateText: { flex: 1 },
    late: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1.5],
        marginHorizontal: size.gutter,
        paddingVertical: space[2],
        paddingHorizontal: space[3],
        borderRadius: radius.lg,
        borderWidth: border.hair,
        borderColor: color.dueSoft,
        backgroundColor: color.dueSoft,
    },
});
