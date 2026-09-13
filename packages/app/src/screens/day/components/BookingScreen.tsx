/**
 * A booking, once the patient is known: what it is for, when it is, and a last
 * look before anything is written. The FAB used to open a walk-in and nothing
 * else, which made the day view a screen you could only add to *now* — the
 * phone call asking for Thursday had nowhere to go. So the walk-in became one
 * answer to "when" (`appointment.walkIn`, booked and checked in on arrival —
 * seated now, or at the end of the procedure already in the chair) and a time
 * on a later day became the other (`appointment.create`).
 *
 * A page rather than a sheet: a plan of procedures, a fortnight of days and a
 * grid of times do not fit above a keyboard. Who it is for is still asked in a
 * sheet (`BookPatientSheet`) — a search box and a short list is what a sheet is
 * good at — and answering it pushes this. The pane sits inside the day tab, so
 * Back returns to the day with its date, branch and scroll intact; the shell
 * lights the Patients tab while it is open, because that is the part of the
 * app this belongs to.
 *
 * The order of the questions is the order of the conversation at the desk:
 * what needs doing, then when they can come, then read it back. Nothing is
 * written until the last step's button. The clinic PC is across Tailscale, so a
 * refusal lands above that button in the words of what was being attempted
 * (§4/§14) — never a toast that slides away while the patient is standing there.
 */
import { type ReactNode, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MoneyValue, ToothGroupCard } from '../../../components/domain';
import { Button, Callout, Chevron, Chip, Select, Textarea, useKeyboardHeight } from '../../../components/ui';
import { border, color, radius, size, space, Text } from '../../../theme';
import { dayLabel, daysOffered, fortnightSlots, slotIsFree, timeLabel } from '../booking';
import { CALENDAR_CLOSED, type CalendarState, closeCalendar, openCalendar } from '../calendar';
import { api, type Branch, type ClinicDay, useLocalMutation, useLocalQuery } from '../data';
import { describeError } from '../errors';
import { isClosed } from '../hours';
import { formatMoney } from '../money';
import { type PatientDraft, patientNameOf, patientPhoneOf, patientRefOf } from '../patientDraft';
import { bookedProcedures, groupByTooth, type PlannedProcedure, toothPosition, totalOf } from '../procedures';
import {
    addDays,
    isoAt,
    localOffsetMinutes,
    monthShort,
    offsetForDate,
    parseKey,
    relativeDayLabel,
    time12,
    todayKey,
} from '../time';
import { CalendarSheet } from './CalendarSheet';
import { CalendarIcon, CheckIcon, DurationIcon, PatientIcon, PinIcon } from './icons';
import { ProcedurePlan } from './ProcedurePlan';
import { SlotPicker } from './SlotPicker';

export type BookingScreenProps = {
    /** Answered by `BookPatientSheet`, or handed straight in by a screen that
     * already has the patient — the patient record books this way. */
    patient: PatientDraft;
    /**
     * Which answer to "when" the page opens on. Set by a caller that has already
     * asked the question — the record's Walk-in means now and its Book means a
     * day to be chosen. Left off, the day on screen decides, which is what the
     * FAB wants.
     */
    timing?: Timing;
    branchId: string | null;
    branches: readonly Branch[];
    schedule: readonly ClinicDay[] | undefined;
    durationOptions: readonly number[];
    defaultDuration: number;
    /** The day the screen behind is on — where a scheduled booking opens. */
    dateKey: string;
    /** Minutes into today: what "now" means, and which times have gone. */
    nowMinutes: number;
    onBack: () => void;
    onBooked: (message: string) => void;
};

/**
 * How far ahead the day strip offers without being asked. Anything past it is
 * reached by name through the calendar — see `daysOffered`.
 */
const STRIP_DAYS = 14;

/** The floating dock's button and its padding — what the scroll has to clear. */
const BAR_HEIGHT = space[3] + size.button + space[4];

type Step = 'what' | 'when' | 'confirm';
type Timing = 'now' | 'later';

const STEPS: { key: Step; label: string }[] = [
    { key: 'what', label: 'Procedures' },
    { key: 'when', label: 'When' },
    { key: 'confirm', label: 'Confirm' },
];

export function BookingScreen({
    patient,
    timing: asked,
    branchId,
    branches,
    schedule,
    durationOptions,
    defaultDuration,
    dateKey,
    nowMinutes,
    onBack,
    onBooked,
}: BookingScreenProps) {
    const today = todayKey();

    const [index, setIndex] = useState(0);
    const [plan, setPlan] = useState<PlannedProcedure[]>([]);
    const [timing, setTiming] = useState<Timing>(
        asked ?? (!isClosed(today, schedule, branchId) && dateKey === today ? 'now' : 'later'),
    );
    const [date, setDate] = useState(dateKey < today ? today : dateKey);
    /**
     * A day past the strip's window, asked for by name — seeded from the day
     * the screen behind was on, and replaced whenever the calendar answers.
     *
     * Without it, opening a booking from a day months out threw that day away
     * before the desk saw the form: the day was not in the window, so the guard
     * below moved the picker to the first day that was, and the only sign of it
     * was the tile at the top quietly reading today.
     */
    const [farDay, setFarDay] = useState<string | null>(
        dateKey > addDays(today, STRIP_DAYS - 1) ? dateKey : null,
    );
    const [calendar, setCalendar] = useState<CalendarState>(CALENDAR_CLOSED);
    const [slotMinutes, setSlotMinutes] = useState<number | null>(null);
    const [duration, setDuration] = useState(defaultDuration);
    const [note, setNote] = useState('');
    const [branch, setBranch] = useState<string | null>(branchId);
    // The dock floats over the scroll, so the body reserves its height — and that
    // height is not a constant. A warning above the bar wraps to as many lines as
    // its text needs, and two of them can show at once, so a fixed inset leaves
    // the end of the content under a notice at full scroll. `BAR_HEIGHT` is the
    // bare bar, which is what the dock measures to before the first layout.
    const [dockHeight, setDockHeight] = useState(BAR_HEIGHT);
    const keyboard = useKeyboardHeight();

    // A walk-in is always "now", whatever day the screen behind is on — the only
    // thing that rules it out is a branch that is not working today. It moves
    // with the branch, because Maadi being open is not Nasr City being open.
    const canWalkIn = !isClosed(today, schedule, branch);
    const branchName = branches.find((row) => row.id === branch)?.name ?? null;

    const walkIn = useLocalMutation(api.walkIn);
    const create = useLocalMutation(api.create);

    const step = STEPS[index]?.key ?? 'confirm';
    // Picking a branch that is not working today takes the walk-in away under
    // the choice already made, so "now" falls back to a time rather than
    // leaving a booking with no when at all.
    const scheduled = timing === 'later' || !canWalkIn;
    const pending = walkIn.pending || create.pending;
    const error = scheduled ? create.error : walkIn.error;
    const failure = error ? describeError(error, scheduled ? 'booking' : 'walk-in') : null;

    const ref = patientRefOf(patient);
    const name = patientNameOf(patient);

    const catalogue = useLocalQuery('procedure-tree', api.procedureTree);

    // Every day the branch works in the fortnight ahead, not just the one on
    // screen: "which days can take a 45-minute visit" cannot be answered from a
    // single day, and a strip offering a day whose every time is gone is the
    // same lie the slot grid used to tell. One request either way — `byDates`
    // batches over `httpBatchLink` — and the day being booked reads its times
    // out of the same answer, so the grid and the Book button cannot disagree.
    const workingDays = useMemo(
        () => daysOffered(today, STRIP_DAYS, farDay, schedule, branch),
        [today, farDay, schedule, branch],
    );

    const fortnight = useLocalQuery(
        `booking-days:${branch}:${workingDays.join(',')}`,
        () => api.byDates(workingDays),
        { enabled: scheduled && workingDays.length > 0 },
    );

    const fetched = fortnight.data;

    // `enabled: false` leaves the query at `success` with no data, and a key
    // change clears data a frame before the fetch starts, so neither status
    // alone is the question: the question is whether the rows are in hand.
    // `fortnightSlots` answers nothing until they are — and only the days that
    // can actually take a visit this long come back as open, so asking for 45
    // minutes on a full Thursday takes Thursday off the strip rather than
    // leaving it there to be tapped and found empty.
    const { slotsByDay, openDays } = useMemo(
        () =>
            fortnightSlots({
                days: workingDays,
                fetched,
                schedule,
                branchId: branch,
                durationMinutes: duration,
                today,
                nowMinutes,
            }),
        [fetched, workingDays, schedule, branch, duration, today, nowMinutes],
    );

    const slots = slotsByDay.get(date) ?? [];

    // Asking for a longer visit can take the day in hand off the strip. Landing
    // on the first day that can still take it beats leaving the picker pointing
    // at a day it no longer offers, with a grid that says nothing is left.
    // Adjusted during render, not in an effect: `openDays` does not depend on
    // `date`, so this settles in one pass, and an effect would paint a frame of
    // the empty grid before correcting it.
    if (openDays.length > 0 && !openDays.includes(date)) {
        setDate(openDays[0] as string);
        setSlotMinutes(null);
    }

    const timeIsFree = !scheduled || slotIsFree(slots, slotMinutes);
    const whenAnswered = !scheduled || (slotMinutes !== null && timeIsFree);
    const ready = ref !== null && branch !== null && whenAnswered;

    function reset() {
        walkIn.reset();
        create.reset();
    }

    function book() {
        if (!ref || !branch || !ready) return;

        const procedures = bookedProcedures(plan);
        const body = note.trim() || null;

        if (!scheduled) {
            walkIn.mutate(
                {
                    patient: ref,
                    branchId: branch,
                    durationMinutes: duration,
                    procedures,
                    note: body,
                    offsetMinutes: localOffsetMinutes(),
                },
                {
                    // A walk-in is never refused for want of room — the booked
                    // day moves out of its way — so the desk is told when it
                    // did, because those are patients who were given a time.
                    //
                    // It is also told when the walk-in did not get the chair
                    // straight away: one procedure is already under way and is
                    // not interrupted, so this patient waits, and the person
                    // saying "you're checked in" needs to be able to say until
                    // when in the same breath.
                    onSuccess: (result) => {
                        const pushed = result.moved.length;
                        const who = name ? `${name} is checked in` : 'Walk-in checked in';
                        const seated = time12(result.appointment.startsAt);
                        // A minute of slack: the round trip alone puts the
                        // start a few seconds behind the clock, and that is
                        // still "now" to the person at the desk.
                        const waits = new Date(result.appointment.startsAt).getTime() > Date.now() + 60_000;

                        const parts = [
                            waits ? `${who}, seen at ${seated.time} ${seated.meridiem}` : who,
                            pushed > 0 ? `${pushed} appointment${pushed === 1 ? '' : 's'} moved back` : null,
                        ].filter((part) => part !== null);

                        onBooked(parts.join(' — '));
                    },
                },
            );
            return;
        }

        if (slotMinutes === null) return;

        create.mutate(
            {
                patient: ref,
                branchId: branch,
                startsAt: isoAt(date, slotMinutes),
                durationMinutes: duration,
                procedures,
                note: body,
                offsetMinutes: offsetForDate(date),
            },
            { onSuccess: () => onBooked(`${name} — ${dayLabel(date)} at ${timeLabel(slotMinutes)}`) },
        );
    }

    // How long is asked before what time, because the grid tiles the day by it.
    // A walk-in has no grid, so it gets the same control on its own.
    const howLong = (
        <View style={styles.section}>
            <Text variant="eyebrow" tone="muted">
                HOW LONG
            </Text>
            {/* Four to a row, wrapping — not one row of `grow` chips. Settings
                lets the clinic keep up to twelve lengths and this screen has to
                draw whatever it finds: `grow` is `flex: 1`, which overrides the
                wrap and squeezes every option onto one line, so at eight of them
                "45 min" came out as three stacked characters. The width is the
                cell's; the chip grows to fill it. */}
            <View style={styles.durations}>
                {durationOptions.map((option) => (
                    <View key={option} style={styles.duration}>
                        <Chip
                            label={`${option} min`}
                            grow
                            selected={duration === option}
                            onPress={() => {
                                setDuration(option);
                                // A new length is a new set of start times, and
                                // the old pick is usually not one of them.
                                setSlotMinutes(null);
                                reset();
                            }}
                        />
                    </View>
                ))}
            </View>
        </View>
    );

    const last = step === 'confirm';
    const stepReady = step === 'when' ? whenAnswered && branch !== null : true;
    const barIdle = last ? !ready : !stepReady;

    return (
        <View style={styles.screen} testID="booking-screen">
            <View style={styles.topbar}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={index === 0 ? 'Back to the day' : 'Back a step'}
                    disabled={pending}
                    onPress={() => {
                        if (index === 0) {
                            onBack();
                            return;
                        }
                        reset();
                        if (scheduled) fortnight.refetch();
                        setIndex(index - 1);
                    }}
                    style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
                >
                    <Chevron direction="back" size={10} tone="ink" />
                </Pressable>
                <Text variant="eyebrow" tone="muted">
                    NEW BOOKING
                </Text>
            </View>

            <View style={styles.identity}>
                <View style={styles.tile}>
                    {scheduled ? (
                        <>
                            <Text variant="title2" script="sans" weight="bold" tone="inverse">
                                {parseKey(date).getDate()}
                            </Text>
                            <Text variant="eyebrow" tone="inverse" style={styles.tileMonth}>
                                {monthShort(date).toUpperCase()}
                            </Text>
                        </>
                    ) : (
                        <Text variant="eyebrow" tone="inverse">
                            NOW
                        </Text>
                    )}
                </View>

                <View style={styles.who}>
                    <Text variant="title2" weight="bold" numberOfLines={1}>
                        {name}
                    </Text>
                    <Text variant="footnote" tone="muted" numberOfLines={1}>
                        {patientPhoneOf(patient) || 'No phone on file'}
                    </Text>
                    <View style={styles.chip}>
                        <Text variant="footnote" weight="bold" tone="ink2">
                            {scheduled
                                ? slotMinutes === null
                                    ? `${dayLabel(date)} · no time yet`
                                    : `${dayLabel(date)} · ${timeLabel(slotMinutes)}`
                                : 'Walk-in · starting now'}
                        </Text>
                    </View>
                </View>
            </View>

            <Steps index={index} />

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={[styles.body, { paddingBottom: dockHeight + space[5] }]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
            >
                {step === 'what' ? (
                    <>
                        <ProcedurePlan
                            value={plan}
                            onChange={setPlan}
                            categories={catalogue.data ?? []}
                            loading={catalogue.status === 'loading'}
                            error={catalogue.status === 'error' ? catalogue.error : null}
                            onRetry={catalogue.refetch}
                        />

                        <Textarea
                            label="Note"
                            value={note}
                            onChangeText={setNote}
                            placeholder="Anything the doctor should know."
                        />
                    </>
                ) : step === 'when' ? (
                    <>
                        <View style={styles.section}>
                            <Text variant="eyebrow" tone="muted">
                                WHEN
                            </Text>

                            {branches.length > 1 ? (
                                <Select
                                    label="Branch"
                                    options={branches.map((row) => ({
                                        value: row.id,
                                        label: row.name,
                                    }))}
                                    value={branch}
                                    onChange={(next) => {
                                        setBranch(next);
                                        setSlotMinutes(null);
                                        // Branches keep different working days, so
                                        // the day in hand may not be one of the new
                                        // one's. Landing on its next working day
                                        // beats a strip with nothing in it.
                                        setDate(nextWorkingDay(date, schedule, next));
                                        reset();
                                    }}
                                    sheetTitle="Which branch"
                                />
                            ) : null}

                            <View style={styles.row}>
                                <Chip
                                    label="Now — walk-in"
                                    grow
                                    selected={!scheduled}
                                    disabled={!canWalkIn}
                                    onPress={() => {
                                        setTiming('now');
                                        reset();
                                    }}
                                />
                                <Chip
                                    label="Another time"
                                    grow
                                    selected={scheduled}
                                    onPress={() => {
                                        setTiming('later');
                                        reset();
                                    }}
                                />
                            </View>

                            {!canWalkIn ? (
                                <Text variant="caption" tone="muted">
                                    {branchName ?? 'The clinic'} is not working today, so there is no walk-in
                                    to take.
                                </Text>
                            ) : !scheduled && dateKey !== today ? (
                                <Text variant="caption" tone="muted">
                                    A walk-in starts now, so it lands on today — not the day on screen.
                                </Text>
                            ) : !scheduled ? (
                                <Text variant="subhead" tone="muted">
                                    Booked and checked in at once, the same as anyone already in the waiting
                                    room.
                                </Text>
                            ) : null}
                        </View>

                        {scheduled ? (
                            <SlotPicker
                                dateKey={date}
                                days={openDays}
                                daysLoading={fetched === undefined && fortnight.status !== 'error'}
                                onPickDate={setDate}
                                onPickFurtherDate={() => setCalendar(openCalendar)}
                                slotMinutes={slotMinutes}
                                onPickSlot={(next) => {
                                    setSlotMinutes(next);
                                    reset();
                                }}
                                slots={slots}
                                loading={fetched === undefined && fortnight.status !== 'error'}
                                error={fortnight.status === 'error' ? fortnight.error : null}
                                onRetry={fortnight.refetch}
                                branchName={branchName}
                                duration={howLong}
                            />
                        ) : (
                            howLong
                        )}
                    </>
                ) : (
                    <>
                        <View style={styles.card}>
                            <SummaryRow
                                label="When"
                                value={
                                    scheduled && slotMinutes !== null
                                        ? `${relativeDayLabel(date)} · ${timeLabel(slotMinutes)}`
                                        : 'Now — walk-in'
                                }
                                icon={<CalendarIcon size={17} />}
                                lead
                            />
                            <SummaryRow label="How long" value={`${duration} min`} icon={<DurationIcon />} />
                            {branches.length > 1 ? (
                                <SummaryRow
                                    label="Branch"
                                    value={branches.find((row) => row.id === branch)?.name ?? '—'}
                                    icon={<PinIcon />}
                                />
                            ) : null}
                            <SummaryRow
                                label="Patient"
                                value={patient.mode === 'new' ? `${name} · new record` : name}
                                icon={<PatientIcon />}
                            />
                        </View>

                        <View style={styles.section}>
                            <View style={styles.head}>
                                <Text variant="eyebrow" tone="muted">
                                    WHAT IS PLANNED
                                </Text>
                                <Text variant="caption" weight="medium" tone="muted">
                                    {plan.length === 0
                                        ? 'Nothing yet'
                                        : `${plan.length} procedure${plan.length === 1 ? '' : 's'}`}
                                </Text>
                            </View>

                            {plan.length === 0 ? (
                                <View style={styles.emptyPlan}>
                                    <Text variant="subhead" tone="muted">
                                        No procedures planned — it will be decided in the chair.
                                    </Text>
                                </View>
                            ) : (
                                <View style={styles.groups}>
                                    {groupByTooth(plan).map((group) => (
                                        <ToothGroupCard
                                            key={group.tooth ?? 'none'}
                                            tooth={group.tooth}
                                            position={toothPosition(group.tooth)}
                                            subtotal={
                                                <MoneyValue
                                                    piastres={group.subtotal}
                                                    variant="headline"
                                                    weight="bold"
                                                />
                                            }
                                            lines={group.items.map((item) => ({
                                                id: item.id,
                                                name: item.name,
                                                detail: item.variant,
                                                money: (
                                                    <MoneyValue
                                                        piastres={item.price}
                                                        variant="body"
                                                        weight="bold"
                                                    />
                                                ),
                                            }))}
                                        />
                                    ))}

                                    <View style={styles.total}>
                                        <Text variant="subhead" tone="muted">
                                            Estimated total
                                        </Text>
                                        <Text variant="title3" weight="bold">
                                            {formatMoney(totalOf(plan))}
                                        </Text>
                                    </View>
                                </View>
                            )}
                        </View>

                        {note.trim() ? (
                            <View style={styles.section}>
                                <Text variant="eyebrow" tone="muted">
                                    NOTE
                                </Text>
                                <View style={styles.noteCard}>
                                    <Text variant="callout" tone="ink2">
                                        {note.trim()}
                                    </Text>
                                </View>
                            </View>
                        ) : null}
                    </>
                )}
            </ScrollView>

            {/* Over the scroll rather than beside it. As a sibling in the column
                the bar took a strip of its own and the grid stopped dead at it,
                clipping the last row of times mid-chip — which no amount of
                transparency fixes, because the content never reached under it.
                `box-none` so the empty width of the dock does not eat taps meant
                for the times behind it. */}
            {/* The keyboard goes in the dock's own floor. The dock is pinned to
                the bottom of a window that `edgeToEdgeEnabled` stops resizing
                (see `ui/useKeyboardHeight`), so with the keys up it stayed put
                and they were drawn over the Note field and the step's button.
                Its bottom edge is fixed and its height is auto, so padding the
                floor grows it upwards and carries both clear — and because
                `dockHeight` is measured off this same view, the scroll's bottom
                padding follows without being told. */}
            <View
                style={[styles.dock, { paddingBottom: keyboard }]}
                pointerEvents="box-none"
                onLayout={(event) => setDockHeight(event.nativeEvent.layout.height)}
            >
                {branch === null ? (
                    <View style={styles.notice}>
                        <Callout tone="warning" title="No branch to book into">
                            The clinic’s branches could not be loaded, so there is nowhere to put this
                            booking.
                        </Callout>
                    </View>
                ) : null}

                {failure ? (
                    <View style={styles.notice}>
                        <Callout tone="warning" title={failure.title}>
                            {failure.body ?? ''}
                        </Callout>
                    </View>
                ) : null}

                <View style={styles.bar}>
                    <Button
                        label={last ? (scheduled ? 'Book it' : 'Start the visit') : 'Next'}
                        block
                        loading={pending}
                        disabled={barIdle}
                        // The only way forward on the screen, so it keeps its fill
                        // while the step is still open. The step above already says
                        // what is missing; a grey slab on a bar with nothing else on
                        // it read as the screen being finished with, not as a
                        // question waiting. It still refuses the press.
                        disabledLook="solid"
                        onPress={() => {
                            if (last) {
                                book();
                                return;
                            }
                            reset();
                            setIndex(index + 1);
                        }}
                        testID="booking-next"
                    />
                </View>
            </View>

            {/* The day view's own calendar, in `book` mode: it counts every
                branch the same way, but the branch here is a field of this form
                and the pick must not move it. Keyed by `seq` for the reason the
                day screens key it — its month is `useState` off the day handed
                in, so a sheet that survived would reopen on the month it was
                last left on. */}
            <CalendarSheet
                key={`booking-calendar:${calendar.seq}`}
                visible={calendar.open}
                selected={date}
                schedule={schedule}
                branches={branches}
                branchId={branch}
                mode="book"
                onPick={(picked) => {
                    setFarDay(picked);
                    setDate(picked);
                    setSlotMinutes(null);
                    reset();
                }}
                onClose={() => setCalendar(closeCalendar)}
            />
        </View>
    );
}

/** Which of the three questions this is — the page's own progress. */
function Steps({ index }: { index: number }) {
    return (
        <View
            accessibilityLabel={`Step ${index + 1} of ${STEPS.length}`}
            style={styles.steps}
            testID="booking-steps"
        >
            {STEPS.map((step, at) => {
                const done = at < index;
                const here = at === index;

                return (
                    <View key={step.key} style={styles.step}>
                        <View style={styles.stepRow}>
                            <View
                                style={[
                                    styles.stepDot,
                                    done && styles.stepDotDone,
                                    here && styles.stepDotHere,
                                ]}
                            >
                                {done ? (
                                    <CheckIcon size={11} stroke={color.inverse} />
                                ) : (
                                    <Text
                                        variant="caption"
                                        script="sans"
                                        weight="bold"
                                        tone={here ? 'inverse' : 'muted'}
                                    >
                                        {at + 1}
                                    </Text>
                                )}
                            </View>
                            <Text
                                variant="footnote"
                                weight={here ? 'bold' : 'medium'}
                                tone={here ? 'ink' : 'muted'}
                                numberOfLines={1}
                                style={styles.grow}
                            >
                                {step.label}
                            </Text>
                        </View>
                        <View style={[styles.stepBar, at <= index && styles.stepBarDone]} />
                    </View>
                );
            })}
        </View>
    );
}

/**
 * `lead` is the one row the eye should land on first — the time it is booked
 * for. `icon` is a slot rather than an icon name so the caller sizes the glyph
 * to its own row; the lead row's text is larger and the icon goes with it.
 * Centred rather than baseline-aligned: a glyph has no baseline to share.
 */
function SummaryRow({
    label,
    value,
    icon,
    lead = false,
}: {
    label: string;
    value: string;
    icon?: ReactNode;
    lead?: boolean;
}) {
    return (
        <View style={styles.summaryLine}>
            <View style={[styles.summaryLabel, styles.grow]}>
                {icon}
                <Text variant="subhead" tone="muted" numberOfLines={1}>
                    {label}
                </Text>
            </View>
            <Text
                variant={lead ? 'headline' : 'callout'}
                weight={lead ? 'bold' : 'semibold'}
                numberOfLines={1}
            >
                {value}
            </Text>
        </View>
    );
}

/**
 * The first day from `from` the branch actually works, within the fortnight the
 * strip offers. A branch with no working day at all keeps the day it was on —
 * there is nowhere better to go, and the picker says so in words.
 */
function nextWorkingDay(
    from: string,
    schedule: readonly ClinicDay[] | undefined,
    branchId: string | null,
): string {
    for (let ahead = 0; ahead < 14; ahead += 1) {
        const key = addDays(from, ahead);
        if (!isClosed(key, schedule, branchId)) return key;
    }
    return from;
}

/** "today"/"tomorrow" read as words in a sentence; a date keeps its capitals. */
const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },

    topbar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        paddingHorizontal: space[3],
        paddingTop: space[2],
        paddingBottom: space[1],
    },
    back: {
        width: 34,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    backPressed: { backgroundColor: color.surface2 },

    identity: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space[3.5],
        paddingHorizontal: size.gutter,
        paddingTop: space[2],
        paddingBottom: space[4],
    },
    tile: {
        width: 56,
        height: 56,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.xl2,
        backgroundColor: color.ink,
    },
    tileMonth: { opacity: 0.62 },
    who: { flex: 1, minWidth: 0, gap: space[1], alignItems: 'flex-start' },
    chip: {
        paddingHorizontal: space[2.5],
        paddingVertical: space[1],
        borderRadius: radius.full,
        backgroundColor: color.surface2,
    },

    steps: {
        flexDirection: 'row',
        gap: space[2],
        paddingHorizontal: size.gutter,
        paddingBottom: space[3.5],
    },
    step: { flex: 1, gap: space[2] },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
    stepDot: {
        width: 22,
        height: 22,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    stepDotHere: { backgroundColor: color.ink, borderColor: color.ink },
    stepDotDone: { backgroundColor: color.ink2, borderColor: color.ink2 },
    stepBar: { height: 4, borderRadius: radius.full, backgroundColor: color.line },
    stepBarDone: { backgroundColor: color.ink },

    scroll: { flex: 1 },
    // No `paddingBottom` here — it is measured off the dock and supplied inline,
    // so the grid's bottom row can always be scrolled clear of the floating bar.
    body: { paddingHorizontal: size.gutter, gap: space[5] },
    section: { gap: space[2.5] },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
    grow: { flex: 1, minWidth: 0 },
    durations: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
    /** Four to a row — 4×23% leaves the three gaps their 8pt and a little slack. */
    duration: { width: '23%' },

    head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },

    card: {
        gap: space[3],
        padding: space[4],
        borderRadius: radius.xl,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    summaryLine: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    summaryLabel: { flexDirection: 'row', alignItems: 'center', gap: space[2] },

    emptyPlan: {
        padding: space[4],
        borderRadius: radius.xl,
        borderWidth: border.hair,
        borderStyle: 'dashed',
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    groups: { gap: space[3] },
    total: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: space[3.5],
        borderRadius: radius.lg,
        backgroundColor: color.surface2,
    },
    noteCard: {
        padding: space[3.5],
        borderRadius: radius.lg,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },

    notice: { paddingHorizontal: size.gutter, paddingBottom: space[2] },
    dock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
    // No fill and no rule: the bar is the page showing through, and the button
    // is the only thing on it that is meant to be seen.
    bar: {
        paddingHorizontal: size.gutter,
        paddingTop: space[3],
        paddingBottom: space[4],
        backgroundColor: color.transparent,
    },
});
