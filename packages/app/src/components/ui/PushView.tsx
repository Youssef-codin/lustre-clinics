/**
 * The list → form transition in both settings editors: an absolutely positioned
 * sibling that slides in from the inline edge and covers the list. Mirrors in
 * Arabic, because a form that arrives from the wrong side reads as going back.
 * Not a navigator — it is one screen showing one of two panes, which keeps the
 * list's scroll position while a row is edited.
 */
import type { ReactNode } from 'react';
// biome-ignore lint/style/noRestrictedImports: runs the slide `Animated.timing` and unmounts on its completion callback — the exit has to finish before the pane leaves the tree
import { useEffect, useRef, useState } from 'react';
import { Animated, I18nManager, StyleSheet, useWindowDimensions } from 'react-native';
import { color } from '../../theme';
import { duration, easing } from './motion';
import { useReducedMotion } from './useReducedMotion';

export type PushViewProps = {
    visible: boolean;
    children: ReactNode;
    /**
     * Fired once the pane has finished leaving and is off the tree — the same
     * half `Sheet` has. A caller holding its routes as a stack needs it: the
     * popped entry has to stay rendered through its own exit animation, and
     * this is the moment it can be dropped. Nothing fires on the way in.
     */
    onClosed?: () => void;
    testID?: string;
};

export function PushView({ visible, children, onClosed, testID }: PushViewProps) {
    // Always 0, even when the pane is already `visible` on its first render.
    // Every caller but the gallery mounts this from `rendered(stack)`, and a
    // route only joins that list at the moment it is pushed — so `visible` is
    // true on the very first render and starting at 1 left the timing animating
    // 1 → 1. The slide ran, moved nothing, and the pane simply appeared.
    const progress = useRef(new Animated.Value(0)).current;
    const [mounted, setMounted] = useState(visible);
    const reducedMotion = useReducedMotion();
    const window = useWindowDimensions();

    // Read through a ref so a caller that rebuilds the callback each render does
    // not restart the slide it is waiting on.
    const closed = useRef(onClosed);
    closed.current = onClosed;

    useEffect(() => {
        if (visible) setMounted(true);
        const animation = Animated.timing(progress, {
            toValue: visible ? 1 : 0,
            duration: reducedMotion ? 0 : duration.push,
            easing: easing.sheet,
            useNativeDriver: true,
        });
        animation.start(({ finished }) => {
            if (!finished || visible) return;
            setMounted(false);
            closed.current?.();
        });
        return () => animation.stop();
    }, [visible, progress, reducedMotion]);

    if (!mounted) return null;

    const offscreen = I18nManager.isRTL ? -window.width : window.width;

    return (
        <Animated.View
            style={[
                styles.pane,
                {
                    transform: [
                        {
                            translateX: progress.interpolate({
                                inputRange: [0, 1],
                                outputRange: [offscreen, 0],
                            }),
                        },
                    ],
                },
            ]}
            testID={testID}
        >
            {children}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    pane: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: color.canvas },
});
