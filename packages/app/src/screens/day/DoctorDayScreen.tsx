/**
 * The day view the doctor has open — `doctor-day-view.html`. It keeps the
 * secretary's header and rows and strips out everything the doctor does not do:
 * no walk-in button, no reminders tab, no check-in pills. That leaves it one
 * write, and it is the one the desk cannot make for him: `checked_in →
 * awaiting_payment`, the moment he is finished and the patient goes out to pay.
 * It lives on the chair card, where he is already looking. Everything else is a
 * read.
 *
 * The secretary's appointment sheet is not mounted here. It is a column of desk
 * writes — check in, no-show, cancel — and the doctor makes none of them; a
 * modal of buttons he must not press is worse than no modal at all. Check-out
 * goes with it: taking payment is the desk's, and it happens on
 * `VisitPaymentScreen`, which this screen never opens. What is mounted here is
 * `DoctorVisitSheet`, which is a read: tapping a row
 * asks what this patient is in for, and the answer is today's plan, with the
 * record one further tap away for the history. That tap leaves this screen —
 * `onOpenRecord` asks the shell, which opens it on the Patients tab.
 *
 * `arrivals` is keyed by the checked-in ids rather than the date, so the queue's
 * order is re-asked when somebody arrives or leaves the chair and not on every
 * tick of the clock.
 */
import { memo, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Banner, Button, RefreshView, Toast, usePullToRefresh } from '../../components/ui';
import { color, size, space } from '../../theme';
import { procedureLabel } from './agenda';
import { CALENDAR_CLOSED, type CalendarState, closeCalendar, openCalendar } from './calendar';
import { splitDoctorDay } from './chair';
import { BeforeThis } from './components/Agenda';
import { CalendarSheet } from './components/CalendarSheet';
import { ChairCard, type ChairCardKind, ChairStrip } from './components/Chair';
import { ClosedDay } from './components/ClosedDay';
import { DayHeader } from './components/DayHeader';
import { DayEmpty, DayError, DaySkeleton } from './components/DayStates';
import { AfterThis } from './components/DoctorAgenda';
import { DoctorVisitSheet } from './components/DoctorVisitSheet';
import { type Appointment, api, checkInTimes, useLocalMutation, useLocalQuery } from './data';
import { describeError } from './errors';
import { isClosed } from './hours';
import { busiestBranch, holdsSlot } from './month';
import { todayKey } from './time';
import { useNowMinutes } from './useNow';

type DoctorDayScreenProps = {
    /** A patient's record is the Patients tab's screen; the shell switches to it. */
    onOpenRecord: (patientId: string) => void;
    /**
     * Bumped by the shell when the Day tab is tapped while it is already up.
     * This screen's stack is one sheet deep, so home is that sheet closed; the
     * date and branch are what the doctor chose and stay.
     */
    goHome?: number;
};

function DoctorDayScreenView({ onOpenRecord, goHome = 0 }: DoctorDayScreenProps) {
    const [dateKey, setDateKey] = useState(todayKey);
    const [branchId, setBranchId] = useState<string | null>(null);
    const [calendar, setCalendar] = useState<CalendarState>(CALENDAR_CLOSED);
    const [seenHome, setSeenHome] = useState(goHome);
    // The appointment the sheet is about. Kept while the sheet slides back out;
    // dropping it on close would blank it mid-animation.
    const [opened, setOpened] = useState<{ appointment: Appointment | null; sheet: boolean }>({
        appointment: null,
        sheet: false,
    });
    const [toast, setToast] = useState<string | null>(null);

    if (goHome !== seenHome) {
        setSeenHome(goHome);
        setOpened((current) => ({ ...current, sheet: false }));
        setCalendar(closeCalendar);
    }

    const nowMinutes = useNowMinutes();

    const schedule = useLocalQuery('schedule', api.schedule);
    const branches = useLocalQuery('branches', api.branches);
    // Fetched for the whole clinic and split here, so the screen opens on the
    // branch holding most of the day rather than on `branches[0]` — see
    // `DayScreen`. A branch the user picked wins over the count.
    const day = useLocalQuery(`day:${dateKey}`, () => api.byDate(dateKey));
    const clinicDay = day.data ?? [];
    const branch =
        branchId ?? busiestBranch(clinicDay.filter(holdsSlot), null) ?? branches.data?.[0]?.id ?? null;

    const appointments = useMemo(
        () => clinicDay.filter((row) => row.branchId === branch),
        [clinicDay, branch],
    );
    const closed = isClosed(dateKey, schedule.data, branch);
    const isToday = dateKey === todayKey();

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

    // Where the chair's bar counts from — see `DayScreen`. `in_chair_at` when
    // there is one, the check-in when the visit predates the column.
    const seatFor = (id: string) => arrivals.data?.inChairAt.get(id) ?? arrivals.data?.checkedInAt.get(id);

    // This screen's reads only — see `DayScreen`. The doctor has no reminders
    // tab and no settings read, so it is four queries rather than six.
    const reads = [day, schedule, branches, arrivals];
    const refreshControl = usePullToRefresh(
        () => {
            day.refetch();
            schedule.refetch();
            branches.refetch();
            if (checkedInIds.length > 0) arrivals.refetch();
        },
        reads.some((read) => read.refreshing || read.status === 'loading'),
    );

    const { chair, headline, strip, list, past } = useMemo(
        () => splitDoctorDay(appointments, arrivals.data?.checkedInAt),
        [appointments, arrivals.data],
    );

    const finish = useLocalMutation(api.awaitPayment);
    const [finishing, setFinishing] = useState<string | null>(null);
    const finishingId = finish.pending ? finishing : null;

    const kind: ChairCardKind =
        headline === null
            ? 'next'
            : headline === chair
              ? 'chair'
              : headline.status === 'checked_in'
                ? 'waiting'
                : 'next';

    // A tap opens the plan, not the record: standing at the chair the question
    // is what is being done today, and the history is the sheet's own button.
    const openVisit = (appointment: Appointment) => setOpened({ appointment, sheet: true });

    // The calendar counts every branch; the picked day carries the one it is
    // busiest in, so the day it promised is the day this draws.
    const pickDay = (nextDate: string, nextBranch: string | null) => {
        setDateKey(nextDate);
        if (nextBranch) setBranchId(nextBranch);
    };

    function finishVisit(appointment: Appointment) {
        setFinishing(appointment.id);
        finish.mutate(appointment.id, {
            onSuccess: () => {
                setToast(`${appointment.patient.name} is at the desk`);
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
            {finish.error ? <Banner tone="warning" message={describeError(finish.error).title} /> : null}

            <View style={styles.body}>
                {day.status === 'loading' ? (
                    <DaySkeleton />
                ) : day.status === 'error' && day.error && appointments.length === 0 ? (
                    <RefreshView refreshControl={refreshControl}>
                        <DayError error={day.error} onRetry={day.refetch} />
                    </RefreshView>
                ) : closed ? (
                    <ClosedDay
                        dateKey={dateKey}
                        appointments={appointments}
                        onSelect={openVisit}
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
                        testID="doctor-agenda"
                    >
                        {isToday ? <BeforeThis appointments={past} onSelect={openVisit} /> : null}

                        {isToday && strip ? (
                            <ChairStrip
                                appointment={strip}
                                procedure={procedureLabel(strip)}
                                seatedAt={seatFor(strip.id)}
                                finishing={finishingId === strip.id}
                                onOpen={openVisit}
                                onOpenRecord={onOpenRecord}
                                onFinish={finishVisit}
                            />
                        ) : null}

                        {isToday ? (
                            <ChairCard
                                appointment={headline}
                                kind={kind}
                                nowMinutes={nowMinutes}
                                procedure={headline ? procedureLabel(headline) : undefined}
                                checkedInAt={
                                    headline ? arrivals.data?.checkedInAt.get(headline.id) : undefined
                                }
                                seatedAt={headline ? seatFor(headline.id) : undefined}
                                finishing={finishingId === headline?.id}
                                onOpenRecord={onOpenRecord}
                                onOpen={openVisit}
                                onFinish={finishVisit}
                            />
                        ) : null}

                        <AfterThis
                            appointments={isToday ? list : appointments}
                            relativeToNow={isToday}
                            onSelect={openVisit}
                        />
                    </ScrollView>
                )}
            </View>

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

            <DoctorVisitSheet
                visible={opened.sheet}
                appointment={opened.appointment}
                onClose={() => setOpened((current) => ({ ...current, sheet: false }))}
                // The sheet goes as the record arrives: two layers, one of them a
                // modal, is a back button with two meanings. The record itself is
                // the Patients tab's screen, so the shell is asked for it and the
                // tab bar moves with it — a record drawn inside the Day tab left
                // the highlight on a day nobody was looking at.
                onOpenRecord={(appointment) => {
                    setOpened((current) => ({ ...current, sheet: false }));
                    onOpenRecord(appointment.patientId);
                }}
            />

            <Toast
                visible={toast !== null}
                message={toast ?? ''}
                onDismiss={() => setToast(null)}
                offset={space[6]}
            />
        </View>
    );
}

/** Memoised for the reason `DayScreen` is — this is the doctor's half of the same pane. */
export const DoctorDayScreen = memo(DoctorDayScreenView);

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },
    body: { flex: 1 },
    agenda: { paddingBottom: size.nav, gap: space[3] },
});
