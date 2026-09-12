/**
 * The day as a list of rows, replacing a duration-sized timeline that spread
 * the day over screens of empty grid. The swipe works either way because the
 * list mirrors in Arabic — the distance commits, not the side. The checked-in
 * pill reads "Waiting" (the card says "In the chair" for exactly one patient),
 * stays legible when the chair is busy rather than disabled, and opens the
 * visit once checked in instead of going inert. An unknown procedure renders
 * `undefined` so the row falls back to the duration alone.
 */
import type { AppointmentStatus } from '@lustre/shared';
// biome-ignore lint/style/noRestrictedImports: the collapse drives an `Animated.timing` imperatively — the tween chases `open` and has to be stopped on cleanup or it outlives the section
import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { statusLabel, statusTone } from '../../../components/domain';
import {
    Button,
    Chevron,
    easing,
    duration as motionDuration,
    useReducedMotion,
} from '../../../components/ui';
import { border, color, radius, size, space, Text } from '../../../theme';
import { procedureLabel } from '../agenda';
import type { Appointment } from '../data';
import { type DayDelay, isProjected, ON_TIME, projectedStart } from '../delay';
import { clock12, minutesOfDay, time12 } from '../time';
import {
    ArrowBackIcon,
    ArrowForwardIcon,
    ChairIcon,
    CheckIcon,
    ClockIcon,
    PaymentIcon,
    WaitingIcon,
} from './icons';

export type AgendaRowProps = {
    appointment: Appointment;
    onPress: () => void;
    procedure?: string;
    dim?: boolean;
    /** The one seated patient — blue, where the queue behind them is orange. */
    inChair?: boolean;
    trailing?: React.ReactNode;
    onNoShow?: () => void;
    /**
     * Minutes-from-midnight this row is realistically going to start, when the
     * day is running behind. Drawn under the booked time, never instead of it:
     * the booked time is what the patient was told on the phone, and the day
     * usually catches up.
     */
    projectedMinutes?: number | null;
};

const SWIPE_THRESHOLD = 96;

export function AgendaRow({
    appointment,
    onPress,
    procedure,
    dim = false,
    inChair = false,
    trailing,
    onNoShow,
    projectedMinutes = null,
}: AgendaRowProps) {
    const slide = useRef(new Animated.Value(0)).current;
    const [armed, setArmed] = useState(false);

    const pan = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponder: (_event, gesture) =>
                onNoShow !== undefined &&
                Math.abs(gesture.dx) > 12 &&
                Math.abs(gesture.dx) > Math.abs(gesture.dy),
            onPanResponderMove: (_event, gesture) => {
                slide.setValue(gesture.dx);
                setArmed(Math.abs(gesture.dx) >= SWIPE_THRESHOLD);
            },
            onPanResponderRelease: (_event, gesture) => {
                const commit = Math.abs(gesture.dx) >= SWIPE_THRESHOLD;
                setArmed(false);
                Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
                if (commit) onNoShow?.();
            },
            onPanResponderTerminate: () => {
                setArmed(false);
                Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
            },
        }),
    ).current;

    const body = { appointment, onPress, procedure, dim, inChair, trailing, projectedMinutes };

    if (!onNoShow) return <RowBody {...body} />;

    return (
        <View style={styles.swipe} {...pan.panHandlers}>
            <View style={styles.behind} pointerEvents="none">
                <Text variant="footnote" weight="semibold" tone={armed ? 'due' : 'muted'}>
                    No-show
                </Text>
                <Text variant="footnote" weight="semibold" tone={armed ? 'due' : 'muted'}>
                    No-show
                </Text>
            </View>
            <Animated.View style={[styles.front, { transform: [{ translateX: slide }] }]}>
                <RowBody {...body} />
            </Animated.View>
        </View>
    );
}

/**
 * Where the patient is, as the row's own fill — the button says what to do next
 * and keeps one colour, so the state has to live somewhere else. Waiting is due
 * — orange, a queue building — and the one seated patient is accent, so the
 * chair reads as apart from the people waiting on it.
 */
const CHAIR_TINT = color.accentSoft;

const TINT: Partial<Record<AppointmentStatus, string>> = {
    checked_in: color.dueSoft,
    awaiting_payment: color.accentSoft,
};

function RowBody({
    appointment,
    onPress,
    procedure,
    dim = false,
    inChair = false,
    trailing,
    projectedMinutes = null,
}: AgendaRowProps) {
    const { time, meridiem } = time12(appointment.startsAt);
    const slipped = projectedMinutes !== null && projectedMinutes > minutesOfDay(appointment.startsAt);
    // The day has moved, so the row shows where it moved to. The booked time is
    // still what the appointment holds and what the detail sheet reads back —
    // the list is answering "when is this patient seen", and the honest answer
    // on a late day is the later one.
    const shown = slipped ? clock12(projectedMinutes) : { time, meridiem };
    const tint = dim ? undefined : inChair ? CHAIR_TINT : TINT[appointment.status];

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${time} ${meridiem}, ${appointment.patient.name}, ${statusLabel(appointment.status)}`}
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                dim && styles.dim,
                tint && [styles.tinted, { backgroundColor: tint }],
                pressed && styles.pressed,
            ]}
        >
            <View style={styles.clock}>
                <Text
                    variant="headline"
                    script="mono"
                    weight="semibold"
                    tone={slipped ? 'due' : dim ? 'muted' : 'ink'}
                    numberOfLines={1}
                >
                    {shown.time}
                </Text>
                <Text variant="tag" tone={slipped ? 'due' : 'muted'}>
                    {shown.meridiem}
                </Text>
            </View>

            <View style={styles.body}>
                <Text
                    variant="headline"
                    weight="semibold"
                    tone={dim ? 'ink2' : 'ink'}
                    numberOfLines={1}
                    style={styles.name}
                >
                    {appointment.patient.name}
                </Text>

                <View style={styles.meta}>
                    <ClockIcon size={13} />
                    <Text variant="subhead" tone="muted" numberOfLines={1} style={styles.name}>
                        {procedure
                            ? `${procedure} · ${appointment.durationMinutes} min`
                            : `${appointment.durationMinutes} min`}
                    </Text>
                </View>
            </View>

            {trailing}
        </Pressable>
    );
}

type CheckInControlProps = {
    appointment: Appointment;
    loading: boolean;
    /** `checked_in` is arrived, not seated — only the queue's head reads as IN. */
    inChair: boolean;
    onCheckIn: (appointment: Appointment) => void;
};

const SHORT: Partial<Record<AppointmentStatus, string>> = {
    checked_in: 'Waiting',
    awaiting_payment: 'At desk',
};

/**
 * Check in is the only thing to press out here — once the patient is inside,
 * the row itself opens the visit, so the trailing slot drops to a chip that
 * only says where they are. A button that repeats the row's own tap reads as a
 * second, different action; the chip takes the button's width so the states
 * still line up down the column.
 */
function CheckInControl({ appointment, loading, inChair, onCheckIn }: CheckInControlProps) {
    if (appointment.status === 'booked') {
        return (
            <Button
                label="Check in"
                variant="secondary"
                size="md"
                loading={loading}
                icon={<CheckIcon size={13} stroke={color.ink} />}
                style={styles.pill}
                onPress={() => onCheckIn(appointment)}
            />
        );
    }

    const label = inChair ? 'In chair' : (SHORT[appointment.status] ?? statusLabel(appointment.status));
    const seated = inChair || appointment.status === 'awaiting_payment';
    const tone = seated ? color.accent : color.due;
    const Icon = inChair ? ChairIcon : appointment.status === 'awaiting_payment' ? PaymentIcon : WaitingIcon;

    return (
        <View style={styles.chip} pointerEvents="none">
            <Icon size={13} stroke={tone} />
            <Text variant="callout" weight="semibold" tone={seated ? 'accent' : 'due'}>
                {label}
            </Text>
        </View>
    );
}

export type UpNextProps = {
    appointments: readonly Appointment[];
    chairId: string | null;
    /** How far behind the day is, so each row can say what its time now means. */
    delay?: DayDelay;
    nowMinutes?: number | null;
    relativeToNow: boolean;
    checkingInId: string | null;
    onSelect: (appointment: Appointment) => void;
    onCheckIn: (appointment: Appointment) => void;
    onNoShow: (appointment: Appointment) => void;
};

export function UpNext({
    appointments,
    chairId,
    delay = ON_TIME,
    nowMinutes = null,
    relativeToNow,
    checkingInId,
    onSelect,
    onCheckIn,
    onNoShow,
}: UpNextProps) {
    if (appointments.length === 0) return null;

    // Off today this is the whole day rather than what is left of it, so the
    // rows are history: nobody checks in to a Tuesday that has been and gone,
    // and swiping one to no-show writes to a day nobody is working. The row
    // says where it ended up instead.
    const live = relativeToNow;

    return (
        <View style={[styles.section, styles.upNext]}>
            <View style={styles.sectionLabel}>
                <ArrowForwardIcon size={13} />
                <Text variant="eyebrow" tone="muted">
                    {`${relativeToNow ? 'AFTER THIS' : 'THE DAY'} · ${appointments.length}`}
                </Text>
            </View>

            {appointments.map((appointment) => (
                <AgendaRow
                    key={appointment.id}
                    appointment={appointment}
                    procedure={procedureLabel(appointment)}
                    onPress={() => onSelect(appointment)}
                    dim={!live}
                    inChair={live && appointment.id === chairId}
                    projectedMinutes={
                        isProjected(appointment, delay)
                            ? projectedStart(appointment, delay, nowMinutes)
                            : null
                    }
                    onNoShow={
                        live && appointment.status === 'booked' ? () => onNoShow(appointment) : undefined
                    }
                    trailing={
                        live ? (
                            <CheckInControl
                                appointment={appointment}
                                loading={checkingInId === appointment.id}
                                inChair={appointment.id === chairId}
                                onCheckIn={onCheckIn}
                            />
                        ) : (
                            <Text variant="footnote" weight="semibold" tone={statusTone(appointment.status)}>
                                {statusLabel(appointment.status)}
                            </Text>
                        )
                    }
                />
            ))}
        </View>
    );
}

export type BeforeThisProps = {
    appointments: readonly Appointment[];
    onSelect: (appointment: Appointment) => void;
};

export function BeforeThis({ appointments, onSelect }: BeforeThisProps) {
    const [open, setOpen] = useState(false);
    // What the rows measure when laid out. Zero until the first pass, which is
    // why the closed state animates from a real number the first time it opens
    // rather than snapping.
    const [contentHeight, setContentHeight] = useState(0);
    const reducedMotion = useReducedMotion();
    const progress = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const to = open ? 1 : 0;
        if (reducedMotion) {
            progress.setValue(to);
            return;
        }
        const tween = Animated.timing(progress, {
            toValue: to,
            duration: motionDuration.fadeup,
            easing: easing.promote,
            // `height` is a layout property, so nothing here can go native —
            // and nothing else may be animated on these nodes with the native
            // driver, or the height tween loses the node to it.
            useNativeDriver: false,
        });
        tween.start();
        return () => tween.stop();
    }, [open, reducedMotion, progress]);

    if (appointments.length === 0) return null;

    // The rows fade a little ahead of the height so the list is legible before
    // the section has finished opening, rather than arriving all at once at the
    // end. They also rise the last few pixels into place.
    const height = progress.interpolate({ inputRange: [0, 1], outputRange: [0, contentHeight] });
    const opacity = progress.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.85, 1] });
    const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-space[2], 0] });
    const spin = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

    return (
        <View style={styles.section}>
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`Before this, ${appointments.length} appointments`}
                onPress={() => setOpen((current) => !current)}
                style={({ pressed }) => [styles.sectionLabel, pressed && styles.pressed]}
            >
                <ArrowBackIcon size={13} />
                <Text variant="eyebrow" tone="muted">
                    {`BEFORE THIS · ${appointments.length}`}
                </Text>
                <View style={styles.spacer} />
                {/* Half a turn rather than swapping `direction`: 'down' rotated
                    180° is 'up' in both scripts, so the chevron's own RTL
                    mirroring is left alone. */}
                <Animated.View style={{ transform: [{ rotate: spin }] }}>
                    <Chevron direction="down" size={7} />
                </Animated.View>
            </Pressable>

            {/* The rows stay mounted and clipped. Something has to lay them out
                for `contentHeight` to exist, and a section that measured itself
                only on the way open would animate from zero to zero the first
                time. `pointerEvents` is what stops a collapsed list swallowing
                taps meant for the day underneath.

                It does not stop TalkBack reaching them, though: clipping is a
                visual matter and a row at zero height is still in the
                accessibility tree, so a collapsed section read out every
                appointment it was hiding. The two flags below are the same
                statement for the two platforms — `accessibilityElementsHidden`
                is iOS, `importantForAccessibility` is Android, and only the
                latter runs today. */}
            <Animated.View
                style={[styles.collapse, { height, opacity }]}
                pointerEvents={open ? 'auto' : 'none'}
                accessibilityElementsHidden={!open}
                importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
            >
                <Animated.View
                    onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)}
                    style={[styles.collapseBody, { transform: [{ translateY }] }]}
                >
                    {appointments.map((appointment) => (
                        <AgendaRow
                            key={appointment.id}
                            appointment={appointment}
                            procedure={procedureLabel(appointment)}
                            onPress={() => onSelect(appointment)}
                            dim
                            trailing={
                                <Text
                                    variant="footnote"
                                    weight="semibold"
                                    tone={appointment.status === 'done' ? 'muted' : 'due'}
                                >
                                    {statusLabel(appointment.status)}
                                </Text>
                            }
                        />
                    ))}
                </Animated.View>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    section: { paddingHorizontal: size.gutter },
    collapse: { overflow: 'hidden' },
    // Absolute so the wrapper's animated height cannot squash it: the body has
    // to report the height it *wants*, not the one it is being given.
    collapseBody: { position: 'absolute', start: 0, end: 0, top: 0 },
    upNext: { marginTop: space[2] },
    sectionLabel: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1.5],
        minHeight: space[6],
    },
    spacer: { flex: 1 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3.5],
        paddingVertical: space[3],
        minHeight: size.row,
        borderBottomWidth: border.hair,
        borderBottomColor: color.line,
    },
    dim: { opacity: 0.72 },
    tinted: {
        paddingHorizontal: space[3],
        marginHorizontal: -space[2],
        borderRadius: radius.lg,
        borderBottomColor: 'transparent',
    },
    swipe: { position: 'relative' },
    behind: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        start: 0,
        end: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: space[4],
    },
    front: { backgroundColor: color.canvas },
    pressed: { backgroundColor: color.surface2 },
    // Never wraps: 62px fitted "9:40 PM" and broke "10:00 PM" onto two lines,
    // so the column jumped between one shape and the other down the list.
    clock: {
        width: 74,
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: space[0.5],
    },
    body: { flex: 1, gap: space[0.5] },
    name: { flexShrink: 1 },
    meta: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
    /** One width for every state, so the column of controls reads as a column. */
    pill: { borderRadius: radius.full, paddingHorizontal: space[3], minWidth: 118 },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[2],
        minWidth: 118,
        minHeight: size.row,
        paddingHorizontal: space[3],
    },
});
