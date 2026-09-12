/**
 * What an appointment is booked for: its planned procedures, grouped by tooth.
 * Both appointment sheets draw it. On the doctor's it is most of the sheet; on
 * the desk's it answers the question the row was tapped to ask, which that sheet
 * used to answer with everything about the booking except what is going to be
 * done.
 *
 * One card for every tooth rather than one each: a booking is usually a single
 * line, and a bordered box per line is more border than plan. The position is
 * spelled out because `UL6` and `UR6` are one letter apart and opposite sides of
 * the mouth.
 *
 * No money. A booking carries no price by design — the visit snapshots the
 * catalogue on the day (§7) — so there is nothing honest to put beside a line.
 *
 * A fragment, not a wrapper, so the heading and the card sit in the sheet's own
 * gap like everything around them.
 */
import { StyleSheet, View } from 'react-native';
import { ToothGroupCard, type ToothGroupLine } from '../../../components/domain';
import { border, color, radius, space, Text } from '../../../theme';
import type { AppointmentProcedure } from '../data';
import { toothGroupsOf, toothPosition } from '../procedures';

export type PlanSummaryProps = {
    procedures: readonly AppointmentProcedure[];
    /** The heading, in the words of whoever is reading: IN FOR at the chair. */
    label: string;
};

export function PlanSummary({ procedures, label }: PlanSummaryProps) {
    const groups = toothGroupsOf(procedures);

    return (
        <>
            <View style={styles.head}>
                <Text variant="eyebrow" tone="muted">
                    {label}
                </Text>
                <Text variant="footnote" tone="muted">
                    {procedures.length === 1 ? '1 procedure' : `${procedures.length} procedures`}
                </Text>
            </View>

            {groups.length === 0 ? (
                // A real and common state: what is done is decided in the chair.
                // Said in a sentence rather than left as an empty card, which
                // reads as a failed load.
                <View style={styles.blank}>
                    <Text variant="subhead" tone="muted">
                        Nothing planned — it will be decided in the chair.
                    </Text>
                </View>
            ) : (
                <View style={styles.plan} testID="plan-summary">
                    {groups.map((group, index) => (
                        <View key={group.tooth ?? 'none'} style={index > 0 ? styles.divided : undefined}>
                            <ToothGroupCard
                                variant="row"
                                tooth={group.tooth}
                                position={toothPosition(group.tooth)}
                                lines={group.items.map(planLine)}
                            />
                        </View>
                    ))}
                </View>
            )}
        </>
    );
}

/**
 * One planned procedure as a `ToothGroupCard` line. The quantity is folded into
 * the name rather than given a column of its own — it is almost always one, and
 * a column that reads `1` down every row is a column about nothing.
 */
function planLine(procedure: AppointmentProcedure): ToothGroupLine {
    return {
        id: procedure.id,
        name: procedure.quantity > 1 ? `${procedure.name} × ${procedure.quantity}` : procedure.name,
        detail: procedure.note,
    };
}

const styles = StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    blank: { paddingBottom: space[1] },
    plan: {
        borderRadius: radius.xl2,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
        overflow: 'hidden',
    },
    divided: { borderTopWidth: border.hair, borderTopColor: color.hair },
});
