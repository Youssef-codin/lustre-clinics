/**
 * The bar under whoever is in the chair, on both the desk's card and the
 * doctor's. It lives in its own component because of the clock: this is the one
 * thing on the day view that ticks every second, and keeping the hook here
 * keeps that re-render inside a bar and a label instead of taking the whole
 * screen with it.
 *
 * The count is what shows the thing is running, and it has to be: over a
 * 30-minute slot on a ~300px track the fill advances about a sixth of a pixel
 * per second. No treatment of the bar can make that visible in real time, which
 * is why the flashing fill this once had was dropped — it drew the eye
 * continuously to say something the bar was not actually doing.
 *
 * So the motion goes on the digits, where there is something real to show. Each
 * new second rolls up into place, the way a stopwatch does. It is tied to the
 * data changing rather than to a loop, which is the difference between this and
 * the pulse: it moves because a second passed, and it is still the rest of the
 * time.
 *
 * `progress.count` is split from `progress.of` upstream so only the half that
 * changes is animated — rolling "/ 30 min" once a second would be nonsense. The
 * readout is right-anchored, so the count growing from `9:59` to `10:00` pushes
 * its own left edge and leaves the suffix where it is.
 *
 * The `ProgressBar` must sit in its own container: it sizes itself with
 * `alignSelf`, which inside a row means nothing at all.
 */
// biome-ignore lint/style/noRestrictedImports: starts a Reanimated timing when the count changes — an animation is precisely the outside thing the rule allows for
import { useEffect, useRef } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ProgressBar, useReducedMotion } from '../../../components/ui';
import { space, Text } from '../../../theme';
import { slotProgress } from '../chair';
import type { Appointment } from '../data';
import { useNowSeconds } from '../useNow';

/** How far below its resting place a new second starts, in px. */
const ROLL = 7;
const ROLL_MS = 260;

export type ChairProgressProps = {
    appointment: Appointment;
    /** `in_chair_at` — when the visit began. Absent until it has loaded. */
    seatedAt?: string;
    /**
     * The ground it is drawn on. The black cards are `ink`, where `live` is the
     * green that reads; the doctor's strip is white, where `live` all but
     * disappears (see `theme/Text.tsx`), so off `ink` the fill is `success`.
     */
    onDark?: boolean;
    style?: StyleProp<ViewStyle>;
};

export function ChairProgress({ appointment, seatedAt, onDark = true, style }: ChairProgressProps) {
    const nowMinutes = useNowSeconds();
    const progress = slotProgress(appointment, nowMinutes, seatedAt);

    return (
        <View style={[styles.progress, style]}>
            <View style={styles.track}>
                <ProgressBar
                    value={progress.value}
                    tone={progress.over ? 'due' : onDark ? 'live' : 'success'}
                    height={5}
                    onDark={onDark}
                    accessibilityLabel="Time into the slot"
                />
            </View>

            {/* One label to a screen reader, so it is not read as two fragments
                a second apart. The pieces below are decoration by then. */}
            <View
                style={styles.readout}
                accessible
                accessibilityRole="text"
                accessibilityLabel={progress.label}
            >
                <TickingCount count={progress.count} />
                <Text variant="footnote" script="mono" weight="medium" tone="muted">
                    {progress.of}
                </Text>
            </View>
        </View>
    );
}

/**
 * The count as an odometer: one column per character, and a column only turns
 * when its own character changes.
 *
 * Keyed by position **from the right**, which is what makes that true across a
 * change of width. Keyed from the left, `9:59 → 10:00` shifts every character
 * into a new slot and the whole row turns over at once; from the right the
 * seconds keep their columns, the minute rolls, and a new leading digit mounts
 * beside them. The colon never changes and so never moves.
 *
 * The font is `mono`, which is doing real work here rather than being a style
 * choice: proportional digits would resize their columns as the numbers change
 * and the row would jitter under the animation.
 */
function TickingCount({ count }: { count: string }) {
    const characters = [...count];

    return (
        <View style={styles.digits}>
            {characters.map((character, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the column *is* the identity — an odometer wheel is defined by where it sits, and counting from the right is what keeps a wheel on its own digit when the count gains one
                <Digit key={characters.length - 1 - index} character={character} />
            ))}
        </View>
    );
}

/**
 * One wheel.
 *
 * `roll` is set to 1 without a tween and then eased back to 0, so the new
 * character appears already displaced and travels up to where the old one was —
 * a wheel turning, not a label sliding off. The wrapper clips, so the character
 * arrives out of the row rather than floating above it.
 *
 * Reanimated runs this on the UI thread, which matters more here than anywhere
 * else in the app: for a 45-minute visit it is four wheels being asked to move
 * once a second for the better part of an hour, and on the JS thread each one
 * would be competing with the re-render that triggered it.
 */
function Digit({ character }: { character: string }) {
    const reducedMotion = useReducedMotion();
    const roll = useSharedValue(0);
    // Null rather than the first character, so a wheel that mounts mid-count —
    // the leading digit that appears at `10:00` — arrives turning like the rest
    // instead of popping into place beside them.
    const shown = useRef<string | null>(null);

    useEffect(() => {
        const turned = shown.current !== character;
        shown.current = character;

        if (reducedMotion || !turned) {
            roll.value = 0;
            return;
        }
        roll.value = 1;
        roll.value = withTiming(0, { duration: ROLL_MS, easing: Easing.out(Easing.cubic) });
    }, [character, reducedMotion, roll]);

    const rolling = useAnimatedStyle(() => ({
        transform: [{ translateY: roll.value * ROLL }],
        opacity: 1 - roll.value * 0.85,
    }));

    return (
        <View style={styles.digit}>
            <Animated.View style={rolling}>
                <Text variant="footnote" script="mono" weight="medium" tone="muted">
                    {character}
                </Text>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    progress: { flexDirection: 'row', alignItems: 'center', gap: space[2.5], marginTop: space[4] },
    track: { flex: 1 },
    readout: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
    digits: { flexDirection: 'row', alignItems: 'center' },
    // Clipped per column, which is what makes it read as a wheel: the character
    // arriving is cut off by the row rather than floating up into the bar.
    digit: { overflow: 'hidden' },
});
