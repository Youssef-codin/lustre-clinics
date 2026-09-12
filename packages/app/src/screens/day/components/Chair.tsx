/**
 * The doctor's two headline pieces from `doctor-day-view.html`: the strip and
 * the black card. The strip is whoever is in the chair, reduced to a name and
 * one button; the card is what comes after. With nothing after, the chair
 * takes the card back and gets its progress bar and Finish button there.
 *
 * The card puts a clock on two things and they run off different stamps, which
 * is the whole point of there being two. The waited counter measures the queue
 * and starts at `checked_in_at`; the progress bar measures the visit and starts
 * at `in_chair_at`. On a patient who walked into an empty chair they are the
 * same instant, and on everyone behind them they are not.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Dot } from '../../../components/ui';
import { border, color, radius, shadow, size, space, Text } from '../../../theme';
import { slotProgress } from '../chair';
import type { Appointment } from '../data';
import { formatDuration, minutesOfDay, time12 } from '../time';
import { useNowSeconds } from '../useNow';
import { ChairProgress } from './ChairProgress';
import { CheckIcon, ClockIcon, ProcedureIcon } from './icons';

export type ChairStripProps = {
    appointment: Appointment;
    procedure?: string;
    /** `in_chair_at` — the strip is only ever drawn for the chair. */
    seatedAt?: string;
    finishing: boolean;
    onOpen: (appointment: Appointment) => void;
    onOpenRecord: (patientId: string) => void;
    onFinish: (appointment: Appointment) => void;
};

/**
 * The strip reads its own clock rather than taking the screen's. Its label is
 * the same count the card's bar draws, and on the shared thirty-second tick the
 * seconds would have sat on `:00` for half a minute at a time — a stopped
 * stopwatch, which is worse than no seconds at all.
 */
export function ChairStrip({
    appointment,
    procedure,
    seatedAt,
    finishing,
    onOpen,
    onOpenRecord,
    onFinish,
}: ChairStripProps) {
    const progress = slotProgress(appointment, useNowSeconds(), seatedAt);

    return (
        <View style={styles.strip} testID="chair-strip">
            <Dot tone="wa" size={7} pulse />

            <View style={styles.stripBody}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${appointment.patient.name}'s record`}
                    onPress={() => onOpenRecord(appointment.patient.id)}
                    style={({ pressed }) => [styles.stripName, pressed && styles.namePressed]}
                >
                    <Text variant="callout" weight="semibold" numberOfLines={1}>
                        {appointment.patient.name}
                    </Text>
                </Pressable>

                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`In the chair: ${appointment.patient.name}`}
                    onPress={() => onOpen(appointment)}
                >
                    <Text variant="footnote" tone="muted" numberOfLines={1}>
                        {procedure ? `${procedure} · ${progress.label}` : progress.label}
                    </Text>
                </Pressable>
            </View>

            <Button
                label="Finish"
                size="md"
                loading={finishing}
                icon={<CheckIcon size={13} stroke={color.inverse} />}
                style={styles.finish}
                onPress={() => onFinish(appointment)}
            />
        </View>
    );
}

export type ChairCardKind = 'chair' | 'waiting' | 'next';

export type ChairCardProps = {
    appointment: Appointment | null;
    kind: ChairCardKind;
    nowMinutes: number;
    procedure?: string;
    /** When the wait started — the `waiting` card counts up from here. */
    checkedInAt?: string;
    /** When the wait ended — the `chair` card's bar counts up from here. */
    seatedAt?: string;
    finishing: boolean;
    onOpen: (appointment: Appointment) => void;
    onOpenRecord: (patientId: string) => void;
    onFinish: (appointment: Appointment) => void;
};

export function ChairCard({
    appointment,
    kind,
    nowMinutes,
    procedure,
    checkedInAt,
    seatedAt,
    finishing,
    onOpen,
    onOpenRecord,
    onFinish,
}: ChairCardProps) {
    if (!appointment) {
        return (
            <View style={[styles.card, styles.empty]} testID="chair-card">
                <Text variant="eyebrow" tone="muted">
                    THE CHAIR
                </Text>
                <Text variant="headline" weight="medium" tone="inverse">
                    Nobody waiting
                </Text>
                <Text variant="subhead" tone="muted">
                    The day is done. Anyone new comes through the desk.
                </Text>
            </View>
        );
    }

    const eyebrow = EYEBROW[kind];
    const slot = time12(appointment.startsAt);
    const progress = slotProgress(appointment, nowMinutes, seatedAt);
    const until = minutesOfDay(appointment.startsAt) - nowMinutes;

    return (
        <View style={styles.card} testID="chair-card">
            <View style={styles.eyebrowRow}>
                <Dot tone={eyebrow.dot} size={7} pulse={eyebrow.pulse} />
                <Text variant="eyebrow" tone={eyebrow.tone}>
                    {eyebrow.label}
                </Text>
                <Text variant="eyebrow" tone="muted" style={styles.eyebrowEnd}>
                    {`${slot.time} ${slot.meridiem}`}
                </Text>
            </View>

            {/* The name goes to the person, the line under it to the visit —
                the same split the secretary's card makes. */}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${appointment.patient.name}'s record`}
                onPress={() => onOpenRecord(appointment.patient.id)}
                style={({ pressed }) => [styles.name, pressed && styles.namePressed]}
            >
                <Text variant="title" weight="semibold" tone="inverse" numberOfLines={1}>
                    {appointment.patient.name}
                </Text>
            </Pressable>

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${eyebrow.label.toLowerCase()}: ${appointment.patient.name}`}
                onPress={() => onOpen(appointment)}
            >
                <View style={styles.detail}>
                    <ProcedureIcon />
                    <Text variant="callout" tone="muted" numberOfLines={1} style={styles.detailText}>
                        {appointment.note ?? procedure ?? progress.window}
                    </Text>
                </View>
            </Pressable>

            {kind === 'chair' ? (
                <>
                    <ChairProgress appointment={appointment} seatedAt={seatedAt} />

                    <Button
                        label="Finish visit"
                        variant="inverse"
                        size="md"
                        block
                        loading={finishing}
                        icon={<CheckIcon size={17} stroke={color.ink} />}
                        style={styles.action}
                        onPress={() => onFinish(appointment)}
                    />
                </>
            ) : null}

            {kind === 'waiting' ? <Waited checkedInAt={checkedInAt} nowMinutes={nowMinutes} /> : null}

            {kind === 'next' ? (
                <View style={styles.footer}>
                    <Text variant="title2" weight="semibold" tone="inverse" style={styles.until}>
                        {until > 0 ? `in ${formatDuration(until)}` : `${formatDuration(-until)} late`}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

function Waited({ checkedInAt, nowMinutes }: { checkedInAt?: string; nowMinutes: number }) {
    if (!checkedInAt) return null;

    const since = time12(checkedInAt);
    const waited = Math.max(0, nowMinutes - minutesOfDay(checkedInAt));

    return (
        <View style={styles.footer}>
            <Text variant="footnote" script="mono" weight="medium" tone="muted">
                {`checked in ${since.time} ${since.meridiem}`}
            </Text>
            <View style={styles.waited}>
                <ClockIcon size={14} stroke={color.due} width={2.2} />
                <Text variant="subhead" weight="semibold" tone="due">
                    {`waiting ${formatDuration(waited)}`}
                </Text>
            </View>
        </View>
    );
}

// The chair's dot holds still: its card carries the progress bar, and the bar
// is what pulses. `waiting` keeps the blink because there is no bar under it —
// nothing else on that card moves.
const EYEBROW = {
    chair: { label: 'IN THE CHAIR', tone: 'live', dot: 'live', pulse: false },
    waiting: { label: 'WAITING', tone: 'due', dot: 'due', pulse: true },
    next: { label: 'NEXT UP', tone: 'muted', dot: 'accent', pulse: false },
} as const satisfies Record<
    ChairCardKind,
    { label: string; tone: 'live' | 'due' | 'muted'; dot: 'live' | 'due' | 'accent'; pulse: boolean }
>;

const styles = StyleSheet.create({
    strip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        marginHorizontal: size.bleed,
        marginBottom: space[2.5],
        paddingVertical: space[2.5],
        paddingStart: space[3.5],
        paddingEnd: space[2.5],
        backgroundColor: color.surface,
        borderRadius: radius.xl,
        borderWidth: border.hair,
        borderColor: color.line,
        boxShadow: shadow.pill,
    },
    stripBody: { flex: 1, gap: space[0.5] },
    finish: { borderRadius: radius.full, paddingHorizontal: space[3.5] },

    card: {
        marginHorizontal: size.bleed,
        padding: space[5],
        backgroundColor: color.ink,
        borderRadius: radius.xl3,
    },
    empty: { gap: space[1] },
    eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
    eyebrowEnd: { marginStart: 'auto' },
    // `flex-start` so the target is the name's own width. Stretched across the
    // card, the gap beside a short name would open the record.
    name: { alignSelf: 'flex-start', maxWidth: '100%', marginTop: space[3.5] },
    stripName: { alignSelf: 'flex-start', maxWidth: '100%' },
    namePressed: { opacity: 0.6 },
    detail: { flexDirection: 'row', alignItems: 'center', gap: space[1.5], marginTop: space[1.5] },
    detailText: { flex: 1 },
    action: { marginTop: space[4] },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        marginTop: space[4],
        paddingTop: space[3.5],
        borderTopWidth: border.hair,
        borderTopColor: 'rgba(255,255,255,0.12)',
    },
    waited: { flexDirection: 'row', alignItems: 'center', gap: space[1.5], marginStart: 'auto' },
    until: { marginStart: 'auto' },
});
