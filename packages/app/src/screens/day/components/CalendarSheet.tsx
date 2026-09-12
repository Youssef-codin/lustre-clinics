/**
 * A month, with how full each day is. The load bar is the reason this is not a
 * date picker — "is Thursday busy" is the question asked over the phone, and
 * counting by opening the day is how someone gets double-booked. The month is
 * one request (`api.byDates` batches via `httpBatchLink`), not thirty-one.
 * Cancelled and no-show rows hold no slot, so they do not make a day look
 * busy. The pick follows the month, so the grid, the summary and "Go to this
 * day" never describe different days.
 *
 * Every cell is one shape: `cellBox` owns the geometry and `fill` is the only
 * thing that paints it, so a state picks a colour and nothing else. That split
 * is not tidiness — it is the fix for square corners. Inside a `Pressable`,
 * Android drops the corner radius when it paints a descendant's background:
 * fully booked came out a hard square while closed and today, which carry a
 * border, came out round, because borders honour the radius when backgrounds
 * do not. What does hold is the clip, so the box clips (`overflow: 'hidden'`)
 * and the fill is a child it clips to shape. The load bar clips itself for the
 * same reason — it is a plain background in the same subtree, and drew as a
 * 3px rectangle rather than a pill. Anything painted in a cell from here on
 * wants the same treatment; a bare `backgroundColor` will come out square.
 *
 * The count is every branch, not the one the day view is on: a receptionist
 * asking "is Thursday busy" is asking about the clinic, and a month scoped to
 * Maadi reads as an empty month rather than a day somewhere else. What that
 * costs is a grid that can promise a day the day view then draws empty, so the
 * pick carries the branch that day is busiest in (`month.ts`) and the day view
 * moves with it. `branchOf` names that branch in the summary and on the
 * button, so the switch is read before it happens rather than noticed after.
 *
 * The pill under the legend cycles that scope — every branch, then each one in
 * turn. Booking into one branch is the other half of the phone call, and a
 * month counting three answers it with days that look busy somewhere else.
 * Scoping filters the month already fetched, so a cycle costs no request and
 * moves no pick, and the choice outlives the sheet (`lastScope`).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Chevron, IconButton, Sheet } from '../../../components/ui';
import { border, color, radius, shadow, size, space, Text } from '../../../theme';
import { api, type Branch, type ClinicDay, useLocalQuery } from '../data';
import { describeError } from '../errors';
import { isClosed } from '../hours';
import { type DayLoad, loadsFrom } from '../month';
import { addMonths, formatDate, formatMonth, monthDays, parseKey, time12, todayKey } from '../time';

export type CalendarSheetProps = {
    visible: boolean;
    selected: string;
    schedule: readonly ClinicDay[] | undefined;
    branches: readonly Branch[];
    branchId: string | null;
    /**
     * What picking a day is for. `open` is the day view: the pick moves the
     * screen onto that day, and takes the branch with it when the day is
     * busiest somewhere else — which is the whole reason the grid counts every
     * branch. `book` is the booking page, where the branch is a field the desk
     * has already answered above this sheet and a booking into Maadi does not
     * become a booking into Nasr City because March is busier there. So the
     * pick reports the day alone and every line about moving branch is dropped.
     */
    mode?: 'open' | 'book';
    onPick: (dateKey: string, branchId: string | null) => void;
    onClose: () => void;
};

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
const FULL_AT = 0.9;
/** Two slots' worth — a track, not a reading, and never wider than a real bar. */
const PENDING_LOAD_WIDTH = 8;

/**
 * The scope outlives the sheet: `DayScreen` remounts it by `seq` on every
 * open, so component state would forget a receptionist who works one branch
 * all morning. `null` counts every branch.
 */
let lastScope: string | null = null;

export function CalendarSheet({
    visible,
    selected,
    schedule,
    branches,
    branchId,
    mode = 'open',
    onPick,
    onClose,
}: CalendarSheetProps) {
    const [month, setMonth] = useState(selected);
    const [pending, setPending] = useState(selected);
    const [scope, setScope] = useState(lastScope);

    const days = monthDays(month);
    const query = useLocalQuery(`month:${month}`, () => api.byDates(days), {
        enabled: visible,
    });

    const scoped =
        query.data && scope
            ? query.data.map((rows) => rows.filter((row) => row.branchId === scope))
            : query.data;

    const loads = scoped ? loadsFrom(days, scoped, schedule, branchId) : new Map<string, DayLoad>();
    const today = todayKey();

    /**
     * Where the second went, measured rather than guessed: switching months
     * redraws the title and the whole grid in about 130ms — `monthDays` and
     * `loadsFrom` are sub-millisecond on a month — and then the load bars land
     * a third of a second later, because `useLocalQuery` is keyed on the month
     * and refetches all ~31 days. Nothing here is worth micro-optimising; the
     * grid was simply drawing a finished-looking month with every bar blank
     * while the count was still in flight, which reads as "empty" and then
     * changes under the reader. So the cells say they do not know yet.
     */
    const counting = query.status === 'loading';

    const leading = parseKey(days[0] ?? month).getDay();
    const cells: (string | null)[] = [...Array<null>(leading).fill(null), ...days];

    const pendingLoad = loads.get(pending);
    // The grid below counts every branch on purpose, but this line describes the
    // one day the desk is about to open, so it asks the branch the pick will
    // actually land in. `branchId` is the screen's *resolved* branch, not the id
    // it has stored — an empty day has no `busiest`, and handing `pickDay` a null
    // there leaves the stored id alone and lets the new date resolve somewhere
    // else entirely. `onPick` is given `pendingBranch` so the day that opens is
    // the one this summary just described.
    const pendingBranch = mode === 'book' ? branchId : (pendingLoad?.busiest ?? branchId);
    const pendingClosed = isClosed(pending, schedule, pendingBranch);

    const branchOf = (id: string | null) => branches.find((row) => row.id === id)?.name;
    const scopeLabel = scope ? (branchOf(scope) ?? 'this branch') : 'all branches';
    const movesTo =
        mode === 'open' && pendingLoad?.busiest && pendingLoad.busiest !== branchId
            ? pendingLoad.busiest
            : null;
    const movesToName = branchOf(movesTo);

    function cycleScope() {
        const at = branches.findIndex((row) => row.id === scope);
        const next = at + 1 >= branches.length ? null : (branches[at + 1]?.id ?? null);
        lastScope = next;
        setScope(next);
    }

    function goToMonth(next: string) {
        setMonth(next);
        const nextDays = monthDays(next);
        setPending(nextDays.includes(today) ? today : (nextDays[0] ?? next));
    }

    return (
        <Sheet
            visible={visible}
            onClose={onClose}
            testID="calendar-sheet"
            footer={
                <Button
                    label={
                        mode === 'book'
                            ? 'Use this day'
                            : movesToName
                              ? `Go to this day in ${movesToName}`
                              : 'Go to this day'
                    }
                    block
                    // Paging to a month lands the pick on its first day, which
                    // can be one the branch is shut — the cells cannot be tapped
                    // onto such a day, but the button would still take it.
                    disabled={mode === 'book' && (pendingClosed || pending < today)}
                    onPress={() => {
                        onPick(pending, pendingBranch);
                        onClose();
                    }}
                />
            }
        >
            <View style={styles.monthBar}>
                <Text variant="title3" weight="semibold">
                    {formatMonth(month)}
                </Text>
                {/* `pressLockMs={0}` because paging is the one thing here meant to
                    be pressed repeatedly. The default lock exists to stop a
                    control answering twice; six months out is six deliberate
                    taps, and at any normal tapping speed the lock eats half. */}
                <View style={styles.monthNav}>
                    <IconButton
                        accessibilityLabel="Previous month"
                        icon={<Chevron direction="back" tone="ink" size={9} />}
                        variant="square"
                        pressLockMs={0}
                        onPress={() => goToMonth(addMonths(month, -1))}
                    />
                    <IconButton
                        accessibilityLabel="Next month"
                        icon={<Chevron direction="forward" tone="ink" size={9} />}
                        variant="square"
                        pressLockMs={0}
                        onPress={() => goToMonth(addMonths(month, 1))}
                    />
                </View>
            </View>

            <View style={styles.weekdays}>
                {WEEKDAY_INITIALS.map((initial, index) => (
                    <Text
                        // biome-ignore lint/suspicious/noArrayIndexKey: two Ts and two Ss
                        key={index}
                        variant="caption"
                        script="sans"
                        weight="bold"
                        tone="muted"
                        style={styles.weekday}
                    >
                        {initial}
                    </Text>
                ))}
            </View>

            <View style={styles.grid}>
                {cells.map((day, index) => {
                    if (!day) {
                        // biome-ignore lint/suspicious/noArrayIndexKey: blank leading cell
                        return <View key={`blank-${index}`} style={styles.cell} />;
                    }

                    const load = loads.get(day);
                    const closed = isClosed(day, schedule);
                    const past = day < today;
                    const picked = day === pending;
                    const full = (load?.fill ?? 0) >= FULL_AT;
                    const fillTone = fillOf({ picked, full, closed });
                    // On the booking page a day the branch cannot take is not a
                    // pick at all: `daysOffered` would drop it and the booking
                    // would land on some other day without a word. The day view
                    // can look at any day, so it keeps every cell.
                    const unbookable = mode === 'book' && (past || isClosed(day, schedule, branchId));

                    return (
                        <Pressable
                            key={day}
                            disabled={unbookable}
                            accessibilityRole="button"
                            accessibilityState={{ selected: picked, disabled: unbookable }}
                            accessibilityLabel={`${day}${closed ? ', closed' : ''}${
                                counting ? ', still counting' : load ? `, ${load.count} booked` : ''
                            }${
                                load?.busiest && load.busiest !== branchId
                                    ? `, mostly in ${branchOf(load.busiest) ?? 'another branch'}`
                                    : ''
                            }`}
                            onPress={() => setPending(day)}
                            style={styles.cell}
                        >
                            {/* A cell carries one edge or none. The pick is the
                                fill, and an absolutely positioned child insets
                                to the padding box — so a border under it stops
                                the fill at its inner edge and leaves a ring of
                                canvas between the two, which is what
                                today-and-selected used to draw. Suppressing the
                                edge rather than insetting the fill is also the
                                answer to the design question underneath it:
                                `fillOf` already rules that a picked day is a
                                pick before it is anything else, and two markers
                                on one cell say the same thing twice. */}
                            <View
                                style={[
                                    styles.cellBox,
                                    !picked && closed && styles.closedEdge,
                                    !picked && day === today && styles.todayEdge,
                                ]}
                            >
                                <View style={[styles.fill, { backgroundColor: fillTone }]} />

                                <Text
                                    variant="callout"
                                    // Instrument Sans, not the mono the rest of the
                                    // cluster gives numbers: DM Mono stops at 500, and
                                    // the grid is read at a glance, so it wants 700.
                                    script="sans"
                                    weight="bold"
                                    tone={picked ? 'inverse' : closed || past || unbookable ? 'muted' : 'ink'}
                                >
                                    {parseKey(day).getDate()}
                                </Text>

                                {/* A track where the bar will be, so a month
                                    mid-count reads as unknown rather than as
                                    empty. Closed days never carry a bar, so
                                    they stay blank and do not promise one. */}
                                <View
                                    style={[
                                        styles.load,
                                        counting
                                            ? {
                                                  width: closed ? 0 : PENDING_LOAD_WIDTH,
                                                  backgroundColor: color.line,
                                              }
                                            : {
                                                  width: Math.min(load?.count ?? 0, 4) * 4,
                                                  backgroundColor:
                                                      !load || closed || load.count === 0
                                                          ? 'transparent'
                                                          : full
                                                            ? color.due
                                                            : color.accent,
                                              },
                                    ]}
                                />
                            </View>
                        </Pressable>
                    );
                })}
            </View>

            <View style={styles.legend}>
                <Legend tone={color.accent} label="booked load" />
                <Legend tone={color.due} label="fully booked" />
                {branches.length > 1 ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Counting ${scopeLabel}, next branch`}
                        onPress={cycleScope}
                        style={styles.legendBranch}
                    >
                        <Text variant="caption" weight="semibold" tone="ink">
                            {scopeLabel}
                        </Text>
                        <Chevron direction="forward" tone="ink" size={7} />
                    </Pressable>
                ) : (
                    <View style={styles.legendBranch}>
                        <Text variant="caption" weight="semibold" tone="ink">
                            {branchOf(branchId) ?? ''}
                        </Text>
                    </View>
                )}
            </View>

            <View style={styles.summary}>
                <Text variant="subhead" weight="semibold">
                    {formatDate(pending)}
                </Text>
                {query.status === 'loading' ? (
                    <Text variant="footnote" tone="muted">
                        Counting the month…
                    </Text>
                ) : query.status === 'error' && query.error ? (
                    <View style={styles.summaryError}>
                        <Text variant="footnote" tone="due">
                            {describeError(query.error, 'day').title}
                        </Text>
                        <Button label="Try again" variant="text" size="md" onPress={query.refetch} />
                    </View>
                ) : (
                    <>
                        <Text variant="footnote" tone="muted">
                            {mode === 'book' && pending < today
                                ? 'That day has gone — pick one from today on.'
                                : pendingClosed
                                  ? 'Closed that day.'
                                  : pendingLoad && pendingLoad.count > 0
                                    ? `${pendingLoad.used} of ${pendingLoad.slots} slots${
                                          pendingLoad.firstAt
                                              ? ` · first ${firstLabel(pendingLoad.firstAt)}`
                                              : ''
                                      }`
                                    : 'Nothing booked yet.'}
                        </Text>
                        {movesToName ? (
                            <Text variant="footnote" tone="accent">
                                Most of it is in {movesToName} — the day opens there.
                            </Text>
                        ) : null}
                    </>
                )}
            </View>
        </Sheet>
    );
}

/**
 * The pick reads over how busy the day is, and both read over a closed day —
 * a shut Friday that is also the pick is a pick first.
 */
function fillOf({ picked, full, closed }: { picked: boolean; full: boolean; closed: boolean }): string {
    if (picked) return color.ink;
    if (full) return color.dueSoft;
    if (closed) return color.canvas;
    return 'transparent';
}

function firstLabel(iso: string): string {
    const { time, meridiem } = time12(iso);
    return `${time} ${meridiem}`;
}

function Legend({ tone, label }: { tone: string; label: string }) {
    return (
        <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: tone }]} />
            <Text variant="caption" tone="muted">
                {label}
            </Text>
        </View>
    );
}

const CELL = size.row;

const styles = StyleSheet.create({
    monthBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: space[3],
    },
    monthTitle: { flexDirection: 'row', alignItems: 'baseline', gap: space[2] },
    monthNav: { flexDirection: 'row', gap: space[1.5] },
    weekdays: { flexDirection: 'row' },
    weekday: { width: `${100 / 7}%`, textAlign: 'center' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space[1] },
    cell: { width: `${100 / 7}%`, height: CELL + space[2], padding: space[0.5] },
    cellBox: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[1],
        borderRadius: radius.md,
        overflow: 'hidden',
    },
    closedEdge: { borderWidth: border.hair, borderStyle: 'dashed', borderColor: color.line },
    todayEdge: { borderWidth: border.thick, borderColor: color.ink },
    fill: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 },
    load: { height: 3, borderRadius: radius.full, overflow: 'hidden' },
    legend: { flexDirection: 'row', alignItems: 'center', gap: space[4], marginTop: space[4] },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
    legendSwatch: { width: space[4], height: 3, borderRadius: radius.full },
    legendBranch: {
        marginStart: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1],
        paddingHorizontal: space[2],
        paddingVertical: space[0.5],
        backgroundColor: color.canvas,
        borderRadius: radius.full,
    },
    summary: {
        marginTop: space[3.5],
        gap: space[1],
        padding: space[3.5],
        backgroundColor: color.surface,
        borderRadius: radius.xl,
        borderWidth: border.hair,
        borderColor: color.line,
        boxShadow: shadow.card,
    },
    summaryError: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
});
