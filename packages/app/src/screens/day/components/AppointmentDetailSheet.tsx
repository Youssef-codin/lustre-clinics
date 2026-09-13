/**
 * One appointment and everything that can happen to it from here. Every write
 * crosses Tailscale and reports its failure *in this sheet*, next to the
 * button that caused it — never a toast that fades. Destructive steps confirm
 * inline because `Sheet` is a `Modal`, and a modal over a modal is how
 * Android's back button ends up cancelling a write already in flight. The
 * inline confirm takes the footer with it: leaving Check in under "Cancel this
 * appointment?" offers two answers to one question. The Check out button is
 * disabled without a visit because (BLOCKED.md) the id is only known for a
 * visit this session checked in.
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { MoneyValue, StatusPill } from '../../../components/domain';
import { Button, Callout, CardDivider, Sheet, Tag } from '../../../components/ui';
import { color, radius, size, space, Text } from '../../../theme';
import {
    type Appointment,
    api,
    useLocalMutation,
    useLocalQuery,
    type Visit,
    visitForAppointment,
} from '../data';
import { describeError } from '../errors';
import { formatSpan, minutesOfDay } from '../time';
import { PlanSummary } from './PlanSummary';

export type AppointmentDetailSheetProps = {
    visible: boolean;
    appointment: Appointment | null;
    onClose: () => void;
    onChanged: () => void;
    onCheckOut: (appointment: Appointment, visit: Visit) => void;
    /**
     * Handed up rather than done here: checking in opens the arrival screen,
     * and that page belongs to the day view. Doing the write in this sheet was
     * how the same button ended up meaning two different things depending on
     * which of them you pressed.
     */
    onCheckIn: (appointment: Appointment) => void;
    /**
     * Both of those open a page over the day, so neither may draw until this
     * sheet is off the screen. See `Sheet`'s `onClosed`.
     */
    onClosed?: () => void;
};

type Confirming = 'cancel' | 'no-show' | null;

/** Statuses that are over: one line saying so, and nothing to press. */
const TAIL: Partial<Record<Appointment['status'], string>> = {
    done: 'This visit is finished.',
    cancelled: 'This appointment was cancelled. The slot is free.',
    no_show: 'Marked as a no-show. The slot is free.',
};

export function AppointmentDetailSheet({
    visible,
    appointment,
    onClose,
    onChanged,
    onCheckOut,
    onCheckIn,
    onClosed,
}: AppointmentDetailSheetProps) {
    const [confirming, setConfirming] = useState<Confirming>(null);

    const awaitPayment = useLocalMutation(api.awaitPayment);
    const cancel = useLocalMutation(api.cancel);
    const noShow = useLocalMutation(api.markNoShow);

    const status = appointment?.status;
    const hasVisit = status === 'checked_in' || status === 'awaiting_payment' || status === 'done';

    const visit = useLocalQuery<Visit | null>(
        `visit:${appointment?.id ?? 'none'}`,
        () => (appointment ? visitForAppointment(appointment.id) : Promise.resolve(null)),
        { enabled: visible && hasVisit },
    );

    const writing = awaitPayment.pending || cancel.pending || noShow.pending;
    const writeError = awaitPayment.error ?? cancel.error ?? noShow.error;

    function after() {
        setConfirming(null);
        onChanged();
        onClose();
    }

    // A confirm left open would come back with the next appointment, and the
    // footer is hidden while one is up — the sheet would reopen with no way in.
    function close() {
        setConfirming(null);
        onClose();
    }

    if (!appointment) {
        return <Sheet visible={visible} onClose={close} onClosed={onClosed} title="Appointment" />;
    }

    const startMinutes = minutesOfDay(appointment.startsAt);

    return (
        <Sheet
            visible={visible}
            onClose={close}
            onClosed={onClosed}
            dismissable={!writing}
            title={appointment.patient.name}
            subtitle={`${formatSpan(
                startMinutes,
                startMinutes + appointment.durationMinutes,
            )} · ${appointment.durationMinutes} min`}
            testID="appointment-detail"
            footer={
                confirming ? null : (
                    <PrimaryAction
                        appointment={appointment}
                        visit={visit.data ?? null}
                        visitLoading={visit.status === 'loading'}
                        checkingIn={false}
                        onCheckIn={() => {
                            close();
                            onCheckIn(appointment);
                        }}
                        onCheckOut={(loaded) => onCheckOut(appointment, loaded)}
                    />
                )
            }
        >
            <View style={styles.headline}>
                <StatusPill status={appointment.status} withDot />
                {appointment.channel === 'walk_in' ? <Tag tone="muted">WALK-IN</Tag> : null}
                <Text variant="footnote" script="mono" weight="medium" tone="muted">
                    {appointment.ref}
                </Text>
            </View>

            {/* Above the phone number, because it is what a row is tapped to
                find out. The sheet held the status, the phone, the note and the
                money, and not the one thing the desk is asked across the counter
                — what they are in for today. */}
            <PlanSummary procedures={appointment.procedures} label="BOOKED FOR" />

            <View style={styles.facts}>
                <Fact label="Phone" value={appointment.patient.phone} mono />
                {appointment.note ? (
                    <>
                        <CardDivider />
                        <Note text={appointment.note} />
                    </>
                ) : null}
            </View>

            {hasVisit ? (
                <VisitPanel
                    visit={visit.data ?? null}
                    loading={visit.status === 'loading'}
                    failed={visit.status === 'error'}
                    onRetry={visit.refetch}
                />
            ) : null}

            {writeError ? (
                <Callout tone="warning" title={describeError(writeError, 'check-in').title}>
                    {describeError(writeError, 'check-in').body ?? ''}
                </Callout>
            ) : null}

            <SecondaryActions
                appointment={appointment}
                confirming={confirming}
                setConfirming={setConfirming}
                sendingToDesk={awaitPayment.pending}
                cancelling={cancel.pending}
                markingNoShow={noShow.pending}
                onSendToDesk={() => awaitPayment.mutate(appointment.id, { onSuccess: after })}
                onCancel={() => cancel.mutate(appointment.id, { onSuccess: after })}
                onNoShow={() => noShow.mutate(appointment.id, { onSuccess: after })}
            />
        </Sheet>
    );
}

function PrimaryAction({
    appointment,
    visit,
    visitLoading,
    checkingIn,
    onCheckIn,
    onCheckOut,
}: {
    appointment: Appointment;
    visit: Visit | null;
    visitLoading: boolean;
    checkingIn: boolean;
    onCheckIn: () => void;
    onCheckOut: (visit: Visit) => void;
}) {
    switch (appointment.status) {
        case 'booked':
            return <Button label="Check in" block loading={checkingIn} onPress={onCheckIn} />;

        case 'checked_in':
        case 'awaiting_payment':
            return (
                <Button
                    label="Check out"
                    block
                    loading={visitLoading}
                    disabled={!visit && !visitLoading}
                    onPress={() => visit && onCheckOut(visit)}
                />
            );

        default:
            return null;
    }
}

function SecondaryActions({
    appointment,
    confirming,
    setConfirming,
    sendingToDesk,
    cancelling,
    markingNoShow,
    onSendToDesk,
    onCancel,
    onNoShow,
}: {
    appointment: Appointment;
    confirming: Confirming;
    setConfirming: (next: Confirming) => void;
    sendingToDesk: boolean;
    cancelling: boolean;
    markingNoShow: boolean;
    onSendToDesk: () => void;
    onCancel: () => void;
    onNoShow: () => void;
}) {
    const status = appointment.status;

    if (status === 'checked_in') {
        return (
            <Group>
                <Button
                    label="Send to the desk"
                    variant="secondary"
                    size="md"
                    block
                    loading={sendingToDesk}
                    onPress={onSendToDesk}
                />
                <Text variant="caption" tone="muted">
                    The chair is free while they pay. It does not settle anything.
                </Text>
            </Group>
        );
    }

    if (status !== 'booked') {
        const tail = TAIL[status];
        return tail ? (
            <Group>
                <Text variant="subhead" tone="muted">
                    {tail}
                </Text>
            </Group>
        ) : null;
    }

    if (confirming) {
        const isCancel = confirming === 'cancel';
        return (
            <Group>
                <Text variant="headline" weight="semibold">
                    {isCancel ? 'Cancel this appointment?' : 'Mark this a no-show?'}
                </Text>
                <Text variant="subhead" tone="muted" style={styles.confirmBody}>
                    {isCancel
                        ? 'The slot goes back on the day and the patient keeps their record. Nothing is deleted.'
                        : 'They did not come. The slot goes back on the day and the visit is left unbooked.'}
                </Text>
                <View style={styles.confirmRow}>
                    <Button
                        label="Keep it"
                        variant="ghost"
                        onPress={() => setConfirming(null)}
                        style={styles.confirmKeep}
                    />
                    <Button
                        label={isCancel ? 'Cancel it' : 'No-show'}
                        variant="danger"
                        loading={isCancel ? cancelling : markingNoShow}
                        onPress={isCancel ? onCancel : onNoShow}
                        style={styles.confirmGo}
                    />
                </View>
            </Group>
        );
    }

    return (
        <Group>
            <Button
                label="Mark no-show"
                variant="secondary"
                size="md"
                block
                onPress={() => setConfirming('no-show')}
            />
            <Button
                label="Cancel appointment"
                variant="dangerText"
                size="md"
                block
                onPress={() => setConfirming('cancel')}
            />
        </Group>
    );
}

/**
 * Everything below the record is one group behind one rule: a hairline, then the
 * actions. It carries its own divider so a status with nothing to say — at the
 * desk, waiting on the checkout — ends the sheet at the record instead of on a
 * rule with an empty row under it.
 */
function Group({ children }: { children: ReactNode }) {
    return (
        <View style={styles.group}>
            <CardDivider />
            <View style={styles.actions}>{children}</View>
        </View>
    );
}

function VisitPanel({
    visit,
    loading,
    failed,
    onRetry,
}: {
    visit: Visit | null;
    loading: boolean;
    failed: boolean;
    onRetry: () => void;
}) {
    if (loading) {
        return (
            <View style={styles.panel}>
                <Text variant="subhead" tone="muted">
                    Loading the visit…
                </Text>
            </View>
        );
    }

    if (failed) {
        return (
            <View style={styles.panel}>
                <Text variant="subhead" tone="due">
                    The visit could not be loaded.
                </Text>
                <Button label="Try again" variant="text" size="md" onPress={onRetry} />
            </View>
        );
    }

    if (!visit) {
        return (
            <View style={styles.panel}>
                <Text variant="subhead" tone="muted">
                    This patient was checked in before the app was opened, so the visit is not to hand. Open
                    it from the visit screen to check them out.
                </Text>
            </View>
        );
    }

    return (
        <View style={styles.panel}>
            <View style={styles.money}>
                <Text variant="subhead" tone="muted">
                    Charged
                </Text>
                <MoneyValue piastres={visit.chargedTotal} />
            </View>
            <View style={styles.money}>
                <Text variant="subhead" tone="muted">
                    Paid
                </Text>
                <MoneyValue piastres={visit.paidTotal} tone="success" />
            </View>
            {visit.balance > 0 ? (
                <View style={styles.money}>
                    <Text variant="subhead" tone="muted">
                        Outstanding
                    </Text>
                    <MoneyValue piastres={visit.balance} tone="due" />
                </View>
            ) : null}
        </View>
    );
}

/**
 * Label and value on one line, not a label column — a fixed column left the
 * phone number stranded in the middle of the sheet with nothing to align to.
 * The number is mono: it is read off the screen onto a keypad.
 */
function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <View style={styles.fact}>
            <Text variant="subhead" tone="muted">
                {label}
            </Text>
            <Text
                variant="body"
                weight={mono ? 'medium' : 'regular'}
                script={mono ? 'mono' : undefined}
                style={styles.factValue}
                selectable
            >
                {value}
            </Text>
        </View>
    );
}

/** The note is prose and gets the full width; a value column would ladder it. */
function Note({ text }: { text: string }) {
    return (
        <View style={styles.note}>
            <Text variant="subhead" tone="muted">
                Note
            </Text>
            <Text variant="body" tone="ink2">
                {text}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    headline: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
    facts: { marginTop: space[1] },
    fact: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[4],
        minHeight: size.row,
    },
    factValue: { flexShrink: 1 },
    note: { paddingVertical: space[2.5], gap: space[1] },
    panel: {
        padding: space[3.5],
        gap: space[2],
        backgroundColor: color.canvas,
        borderRadius: radius.xl,
    },
    money: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    group: { marginTop: space[2], gap: space[4] },
    actions: { gap: space[2] },
    confirmBody: { marginBottom: space[1] },
    confirmRow: { flexDirection: 'row', gap: space[2] },
    confirmKeep: { flex: 1 },
    confirmGo: { flex: 1.4 },
});
