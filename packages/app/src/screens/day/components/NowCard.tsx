/**
 * The chair, at the top of the screen — the black card from
 * `day-view-schedule.html`. The list answers "what does today look like"; this
 * answers "what is happening right now", and it has three states because the
 * clinic has three: someone in the chair or at the desk, someone due next, and
 * nobody. The bar under the chair is `ChairProgress`, which is its own
 * component because it runs its own per-second clock and this card must not
 * re-render at that rate.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Dot } from '../../../components/ui';
import { color, radius, size, space, Text } from '../../../theme';
import { slotProgress } from '../chair';
import type { Appointment } from '../data';
import { formatDuration, minutesOfDay, time12 } from '../time';
import { ChairProgress } from './ChairProgress';
import { CheckIcon, ClockIcon } from './icons';

export type NowCardProps = {
    active: Appointment | null;
    next: Appointment | null;
    nowMinutes: number;
    procedure?: string;
    /** `in_chair_at` — where the bar counts from. Absent for whoever is at the desk. */
    seatedAt?: string;
    onCheckIn: (appointment: Appointment) => void;
    onOpen: (appointment: Appointment) => void;
    onOpenRecord: (patientId: string) => void;
    checkingInId: string | null;
};

/**
 * The card is its own button, doing what the button at the foot of it does —
 * the whole thing is a target for the one action it offers. The name is the
 * exception and sits over it: a person's name is a way to that person, not a
 * second way to check them in. `accessible={false}` keeps the card out of the
 * screen reader's way, because the button inside already announces the action
 * and a card that announced itself would only read it twice.
 */
function Card({ onPress, children }: { onPress?: () => void; children: React.ReactNode }) {
    if (!onPress) return <View style={styles.card}>{children}</View>;

    return (
        <Pressable
            accessible={false}
            onPress={onPress}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        >
            {children}
        </Pressable>
    );
}

/** The patient's name, which opens their record wherever it is drawn. */
function Name({
    appointment,
    onOpenRecord,
}: {
    appointment: Appointment;
    onOpenRecord: (id: string) => void;
}) {
    return (
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
    );
}

function StartedAt({ appointment }: { appointment: Appointment }) {
    const { time, meridiem } = time12(appointment.startsAt);
    return (
        <Text variant="eyebrow" tone="muted" style={styles.startedAt}>
            {`${time} ${meridiem}`}
        </Text>
    );
}

export function NowCard({
    active,
    next,
    nowMinutes,
    procedure,
    seatedAt,
    onCheckIn,
    onOpen,
    onOpenRecord,
    checkingInId,
}: NowCardProps) {
    if (active) {
        const inChair = active.status === 'checked_in';
        const progress = slotProgress(active, nowMinutes, seatedAt);

        return (
            <Card onPress={() => onOpen(active)}>
                {/* The dot holds still. Nothing on this card blinks: the
                    seconds in the bar's label change once a second, which is
                    the one honest sign the visit is running. */}
                <View style={styles.eyebrowRow}>
                    <Dot tone={inChair ? 'live' : 'due'} size={7} />
                    <Text variant="eyebrow" tone={inChair ? 'live' : 'due'}>
                        {inChair ? 'IN THE CHAIR' : 'AT THE DESK'}
                    </Text>
                    <StartedAt appointment={active} />
                </View>

                <Name appointment={active} onOpenRecord={onOpenRecord} />

                <View style={styles.detail}>
                    <ClockIcon />
                    <Text variant="callout" tone="muted" numberOfLines={1} style={styles.detailText}>
                        {active.note ?? procedure ?? progress.window}
                    </Text>
                </View>

                {inChair ? <ChairProgress appointment={active} seatedAt={seatedAt} /> : null}

                <Button
                    label={inChair ? 'Finish visit' : 'Take payment'}
                    variant="inverse"
                    size="md"
                    block
                    icon={<CheckIcon size={17} stroke={color.ink} />}
                    style={styles.action}
                    onPress={() => onOpen(active)}
                />
            </Card>
        );
    }

    if (next) {
        const until = minutesOfDay(next.startsAt) - nowMinutes;
        const { time, meridiem } = time12(next.startsAt);

        return (
            <Card onPress={() => onCheckIn(next)}>
                <View style={styles.eyebrowRow}>
                    <Dot tone="accent" size={7} />
                    <Text variant="eyebrow" tone="muted">
                        NEXT UP
                    </Text>
                    <StartedAt appointment={next} />
                </View>

                <Name appointment={next} onOpenRecord={onOpenRecord} />

                <View style={styles.detail}>
                    <ClockIcon />
                    <Text variant="callout" tone="muted" style={styles.detailText}>
                        {until > 0
                            ? `${time} ${meridiem} · in ${formatDuration(until)}`
                            : `${time} ${meridiem} · ${formatDuration(Math.abs(until))} late`}
                    </Text>
                </View>

                <Button
                    label="Check in"
                    variant="inverse"
                    size="md"
                    block
                    icon={<CheckIcon size={17} stroke={color.ink} />}
                    style={styles.action}
                    loading={checkingInId === next.id}
                    onPress={() => onCheckIn(next)}
                />
            </Card>
        );
    }

    return (
        <View style={[styles.card, styles.empty]}>
            <Text variant="eyebrow" tone="muted">
                THE CHAIR
            </Text>
            <Text variant="headline" weight="medium" tone="inverse">
                Nobody in the chair
            </Text>
            <Text variant="subhead" tone="muted">
                Nothing left to check in today.
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: size.bleed,
        padding: space[5],
        backgroundColor: color.ink,
        borderRadius: radius.xl3,
    },
    // A lift off `ink`, not a wash over it: the card is already the darkest
    // thing on the screen, so the press has nowhere to go but up.
    cardPressed: { backgroundColor: color.ink2 },
    empty: { gap: space[1], padding: space[5] },
    eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
    startedAt: { marginStart: 'auto' },
    // `flex-start` so the target is the name's own width: stretched across the
    // card, the gap beside a short name would open the record instead of doing
    // what the rest of the card does.
    name: { alignSelf: 'flex-start', maxWidth: '100%', marginTop: space[3.5] },
    namePressed: { opacity: 0.6 },
    detail: { flexDirection: 'row', alignItems: 'center', gap: space[1.5], marginTop: space[1.5] },
    detailText: { flex: 1 },
    action: { marginTop: space[4] },
});
