/**
 * When the booking is — a fortnight of days, and the times that day still has
 * free. It draws what `BookingScreen` fetched rather than fetching itself,
 * so the grid and the Book button read the same slots: the button has to refuse
 * a time that went while the note was being typed, and it can only do that if
 * there is one answer to "is 3:00 free", not two.
 *
 * How long comes first, because the length decides both of the answers under
 * it: the grid tiles the day by it, and a day with no room for forty-five
 * minutes is not a day this booking can have. Asking it last meant every answer
 * above it changed the moment it was given.
 *
 * Only free times are drawn. A grid of greyed-out hours is mostly noise on a
 * busy day — what the desk is choosing between is what is left, so that is what
 * it is shown, and the count says how many. A time that goes *while* the
 * booking is being filled in is the one exception: it disappears from the grid,
 * and the callout underneath says why the picked one no longer stands.
 *
 * The strip is the same idea one scale up: the days that can take this booking,
 * and only those. Not the branch's working days — a Thursday whose every time
 * has gone is as much use as a Friday it is shut — so `BookingScreen` reads the
 * whole fortnight and hands down what is left. What is offered is what can be
 * booked, at every scale.
 *
 * The strip ends in a way out of it, because a fortnight is the near question
 * and not the only one: a check-up booked six months ahead is an ordinary thing
 * to ask for at the desk, and before this the strip was the only answer to
 * "which day", so it was also the limit on how far ahead the clinic could book
 * at all. The calendar is the same one the day view opens, so "is March busy"
 * is asked and answered the same way wherever it comes up.
 */
import { useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Callout, Chip } from '../../../components/ui';
import { border, color, radius, space, Text } from '../../../theme';
import type { Slot } from '../booking';
import type { RequestError } from '../data';
import { describeError } from '../errors';
import { clock12, relativeDayLabel } from '../time';
import { CalendarIcon } from './icons';

export type SlotPickerProps = {
    dateKey: string;
    /** The days that can take this booking — already filtered, in order. */
    days: readonly string[];
    /** The fortnight is still being read: "no days" is not the answer yet. */
    daysLoading: boolean;
    onPickDate: (dateKey: string) => void;
    /** Open the calendar, for a day further out than the strip reaches. */
    onPickFurtherDate: () => void;
    slotMinutes: number | null;
    onPickSlot: (minutes: number | null) => void;
    slots: readonly Slot[];
    /** The day behind the grid: it has to say "still loading" before "no times". */
    loading: boolean;
    error: RequestError | null;
    onRetry: () => void;
    branchName: string | null;
    /** The HOW LONG control, drawn above the two answers it decides. */
    duration: React.ReactNode;
};

export function SlotPicker({
    dateKey,
    days,
    daysLoading,
    onPickDate,
    onPickFurtherDate,
    slotMinutes,
    onPickSlot,
    slots,
    loading,
    error,
    onRetry,
    branchName,
    duration,
}: SlotPickerProps) {
    const picked = slots.find((slot) => slot.minutes === slotMinutes) ?? null;
    const free = slots.filter((slot) => slot.state === 'free');

    const strip = useRef<ScrollView>(null);
    // A day off the calendar sorts after every day in the window, so it is
    // always the last chip — and the strip starts at its own beginning, which
    // left the day just chosen sitting past the right edge of a strip that
    // looked like nothing was selected at all. The content changing width is
    // the moment that day joined it, and the only moment worth scrolling on:
    // every other day the strip offers is reachable without moving it.
    const stripEndsOnPick = days.length > 0 && days[days.length - 1] === dateKey;

    return (
        <View style={styles.step}>
            {duration}

            <View style={styles.section}>
                <Text variant="eyebrow" tone="muted">
                    WHICH DAY
                </Text>
                {daysLoading ? (
                    <Text variant="subhead" tone="muted">
                        Reading the fortnight…
                    </Text>
                ) : (
                    <>
                        <ScrollView
                            ref={strip}
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.strip}
                            onContentSizeChange={() => {
                                if (stripEndsOnPick) strip.current?.scrollToEnd({ animated: false });
                            }}
                        >
                            {days.map((key) => (
                                <Chip
                                    key={key}
                                    label={relativeDayLabel(key)}
                                    selected={key === dateKey}
                                    onPress={() => {
                                        onPickDate(key);
                                        onPickSlot(null);
                                    }}
                                />
                            ))}
                            {/* Last, not first: the near days are what most
                                bookings want, and a control ahead of them would
                                be passed over on every one of those. */}
                            <Chip
                                label="Another date"
                                variant="new"
                                icon={<CalendarIcon size={15} stroke={color.accent} />}
                                onPress={onPickFurtherDate}
                                testID="booking-further-date"
                            />
                        </ScrollView>

                        {days.length === 0 ? (
                            <Text variant="subhead" tone="muted">
                                {branchName ?? 'This branch'} has no day in the next fortnight with room for a
                                visit this long. Try a shorter one, another branch, or a date further out.
                            </Text>
                        ) : null}
                    </>
                )}
            </View>

            <View style={styles.section}>
                <View style={styles.timesHead}>
                    <Text variant="eyebrow" tone="muted">
                        WHAT TIME
                    </Text>
                    {!loading && !error && slots.length > 0 ? (
                        <Text variant="caption" weight="medium" tone="muted">
                            {free.length} free
                        </Text>
                    ) : null}
                </View>

                {loading ? (
                    <Text variant="subhead" tone="muted">
                        Reading that day…
                    </Text>
                ) : error ? (
                    <View style={styles.failure}>
                        <Text variant="subhead" tone="due">
                            {describeError(error, 'day').title}
                        </Text>
                        <Button label="Try again" variant="text" size="md" onPress={onRetry} />
                    </View>
                ) : free.length === 0 ? (
                    <Text variant="subhead" tone="muted">
                        {slots.length === 0
                            ? 'No times that day.'
                            : 'Every time that day has gone — pick another day above.'}
                    </Text>
                ) : (
                    <>
                        <View style={styles.grid}>
                            {free.map((slot) => (
                                <SlotChip
                                    key={slot.minutes}
                                    slot={slot}
                                    selected={slot.minutes === slotMinutes}
                                    onPress={() => onPickSlot(slot.minutes)}
                                />
                            ))}
                        </View>

                        {picked && picked.state !== 'free' ? (
                            <Callout
                                tone="warning"
                                title={
                                    picked.state === 'taken'
                                        ? 'That time is already booked'
                                        : 'That time has gone by'
                                }
                            >
                                Pick another one — a shorter visit may also fit.
                            </Callout>
                        ) : picked?.runsLate ? (
                            <Text variant="caption" tone="muted">
                                That visit ends after the clinic closes.
                            </Text>
                        ) : null}
                    </>
                )}
            </View>
        </View>
    );
}

function SlotChip({ slot, selected, onPress }: { slot: Slot; selected: boolean; onPress: () => void }) {
    const { time, meridiem } = clock12(slot.minutes);

    return (
        <View style={styles.slot}>
            <Chip
                label={`${time} ${meridiem}`}
                selected={selected}
                disabled={slot.state !== 'free'}
                grow
                onPress={onPress}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    step: { gap: space[5] },
    section: { gap: space[2.5] },
    strip: { gap: space[2], paddingEnd: space[4] },
    timesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
    slot: { width: '31.5%' },
    failure: {
        gap: space[2],
        padding: space[3],
        borderRadius: radius.lg,
        borderWidth: border.hair,
        borderColor: color.line,
    },
});
