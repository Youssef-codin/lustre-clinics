/**
 * The doctor's two headline pieces: the strip and the black card. The strip is
 * whoever is in the chair while the card belongs to what comes after; with
 * nothing after, the chair takes the card back. Both forms say IN THE CHAIR and
 * both carry the bar and a Finish button, so the chair reads as the same thing
 * in either.
 *
 * The chair puts a clock on two things and they run off different stamps, which
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
import { formatDuration, formatSpan, minutesOfDay, time12 } from '../time';
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
 * The chair, while the black card belongs to whoever comes after it.
 *
 * It was a name, a line and a button, and beside the AFTER THIS rows it read as
 * one more of them. There is one practitioner and one chair, so who is in it is
 * a fact to state rather than a row to infer: the strip names itself IN THE
 * CHAIR in the card form's own words, and carries the card form's bar. So the
 * chair looks like the same thing whether or not anything follows it.
 *
 * The two clocks stay two. The bar counts the visit from `in_chair_at`; the
 * waiting card under it counts the queue from `checked_in_at`.
 *
 * It stays white. Dark, it would compete with the card for the place the eye
 * lands first, and the card is what the doctor turns to next — which is the
 * reason the strip form exists at all.
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
    const starts = minutesOfDay(appointment.startsAt);

    return (
        <View style={styles.strip} testID="chair-strip">
            <View style={styles.stripHead}>
                <View style={styles.stripBody}>
                    <View style={styles.eyebrowRow}>
                        <Dot tone="wa" size={7} />
                        <Text variant="eyebrow" tone="successText">
                            IN THE CHAIR
                        </Text>
                    </View>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${appointment.patient.name}'s record`}
                        onPress={() => onOpenRecord(appointment.patient.id)}
                        style={({ pressed }) => [styles.stripName, pressed && styles.namePressed]}
                    >
                        <Text variant="headline" weight="semibold" numberOfLines={1}>
                            {appointment.patient.name}
                        </Text>
                    </Pressable>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`In the chair: ${appointment.patient.name}`}
                        onPress={() => onOpen(appointment)}
                    >
                        <Text variant="footnote" tone="muted" numberOfLines={1}>
                            {procedure ?? formatSpan(starts, starts + appointment.durationMinutes)}
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

            <ChairProgress
                appointment={appointment}
                seatedAt={seatedAt}
                onDark={false}
                style={styles.stripProgress}
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
                {/* The booked time, and only where it earns its place: on NEXT UP
                    it is when they are due, and in the chair it is the slot being
                    worked through. Once someone is waiting they are already here,
                    and a bare time up here sat right above a labelled arrival time
                    and read as something about now. The booked time is still on
                    the detail sheet. */}
                {kind === 'waiting' ? null : (
                    <Text variant="eyebrow" tone="muted" style={styles.eyebrowEnd}>
                        {`${slot.time} ${slot.meridiem}`}
                    </Text>
                )}
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
        marginHorizontal: size.bleed,
        marginBottom: space[2.5],
        paddingVertical: space[3],
        paddingStart: space[3.5],
        paddingEnd: space[3],
        backgroundColor: color.surface,
        borderRadius: radius.xl,
        borderWidth: border.hair,
        borderColor: color.line,
        boxShadow: shadow.pill,
    },
    stripHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    stripBody: { flex: 1, gap: space[1] },
    stripProgress: { marginTop: space[3] },
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
