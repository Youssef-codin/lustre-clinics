/**
 * What this patient is in for — the sheet the doctor gets when he taps a row on
 * his day. It replaces the secretary's appointment sheet, which was a column of
 * desk writes he must not press (check in, no-show, cancel) and never drew the
 * one thing he opens a row to see: `appointment.procedures`.
 *
 * So this sheet is a read. Its only action leaves it — "Open patient record" —
 * and the sheet exists because that record is the wrong first answer: standing
 * over the chair, the question is "what am I doing to this person", not "what
 * did we do in 2023". The plan is two taps closer than the history now, and the
 * history is still one tap away.
 *
 * The plan itself is `PlanSummary`, which the desk's appointment sheet draws
 * too, so both roles read what a booking is for the same way.
 */
import { StyleSheet, View } from 'react-native';
import { StatusPill } from '../../../components/domain';
import { Button, Sheet } from '../../../components/ui';
import { border, color, radius, space, Text } from '../../../theme';
import type { Appointment } from '../data';
import { dateKey, formatSpan, minutesOfDay, relativeDayLabel } from '../time';
import { PlanSummary } from './PlanSummary';

export type DoctorVisitSheetProps = {
    visible: boolean;
    appointment: Appointment | null;
    onClose: () => void;
    /** The record for this patient — the sheet's one way out that is not "close". */
    onOpenRecord: (appointment: Appointment) => void;
};

export function DoctorVisitSheet({ visible, appointment, onClose, onOpenRecord }: DoctorVisitSheetProps) {
    return (
        <Sheet
            visible={visible}
            onClose={onClose}
            testID="doctor-visit-sheet"
            footer={
                appointment ? (
                    <Button
                        label="Open patient record"
                        block
                        onPress={() => onOpenRecord(appointment)}
                        testID="open-record"
                    />
                ) : null
            }
        >
            {appointment ? (
                <>
                    <Identity appointment={appointment} />

                    <PlanSummary procedures={appointment.procedures} label="IN FOR" />

                    {appointment.note ? (
                        <View style={styles.note}>
                            <Text variant="eyebrow" tone="muted">
                                NOTE FROM THE DESK
                            </Text>
                            <Text variant="body" tone="ink2" style={styles.noteText}>
                                {appointment.note}
                            </Text>
                        </View>
                    ) : null}
                </>
            ) : null}
        </Sheet>
    );
}

/**
 * The mock's identity block, with the length of the visit on the dark tile
 * where it puts the date. The tile is 64pt and a start time is not: `10:00 AM`
 * set at headline clipped its meridiem. The line under the name already carries
 * the day and both ends of the slot, so the hour was the one thing on the tile
 * said twice, and how long he has is the thing it was not saying at all.
 */
function Identity({ appointment }: { appointment: Appointment }) {
    return (
        <View style={styles.identity}>
            <View style={styles.tile}>
                <Text variant="title3" script="sans" weight="semibold" tone="inverse">
                    {String(appointment.durationMinutes)}
                </Text>
                <Text variant="tag" tone="inverse" style={styles.tileSub}>
                    MIN
                </Text>
            </View>

            <View style={styles.who}>
                <Text variant="title2" weight="semibold" numberOfLines={2}>
                    {appointment.patient.name}
                </Text>
                <Text variant="subhead" tone="muted">
                    {slotLabel(appointment)}
                </Text>
                <View style={styles.status}>
                    <StatusPill status={appointment.status} withDot />
                </View>
            </View>
        </View>
    );
}

/** `Today · 11:35 AM – 12:35 PM`. */
function slotLabel(appointment: Appointment): string {
    const start = new Date(appointment.startsAt);
    const from = minutesOfDay(appointment.startsAt);
    return `${relativeDayLabel(dateKey(start))} · ${formatSpan(from, from + appointment.durationMinutes)}`;
}

const styles = StyleSheet.create({
    identity: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3.5] },
    tile: {
        width: 64,
        height: 56,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        borderRadius: radius.xl2,
        backgroundColor: color.ink,
    },
    // The mock's `rgba(255,255,255,.62)` — a second white on ink, which the
    // palette has no token for because nothing else sits on a dark ground.
    tileSub: { opacity: 0.62 },
    who: { flex: 1, gap: space[1] },
    status: { flexDirection: 'row', paddingTop: space[1] },

    note: {
        gap: space[1.5],
    },
    noteText: {
        lineHeight: 21,
        padding: space[3],
        borderRadius: radius.lg,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.canvas,
    },
});
