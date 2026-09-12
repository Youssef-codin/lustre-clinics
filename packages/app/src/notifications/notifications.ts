/**
 * The `expo-notifications` side of the daily reminder nudge — permission, the
 * Android channel, and arming the instants [`schedule.ts`](./schedule.ts)
 * works out. Nothing here decides *when*; that is the rule, and the rule is
 * tested.
 *
 * **Local, not push** (SPEC §11, and the reason it is worth writing down). A
 * server push needs a device registry and a push service, which is a lot of new
 * machinery for one notification and is dead exactly when the clinic PC is off —
 * a power cut is when the desk most needs to be told the list is still there.
 * The pane already frames the two settings as being about this phone ("Notify me
 * at", not "notify the clinic"), so each user is nudged about their own list.
 *
 * **The body carries no count.** A nudge is armed hours before it fires and the
 * list can move on the other phone in between, so "3 reminders" would go stale
 * into a wrong number. "Reminders are waiting" is true whenever any are pending
 * and cannot be wrong by one.
 *
 * **Never any patient data** (§17): no name, no phone, no ref. A notification
 * shows on a lock screen in a waiting room.
 *
 * Arming is always cancel-then-schedule over this one channel, never a diff. The
 * plan is cheap to recompute and a diff is how a phone ends up with two series
 * layered over each other, each buzzing on its own half-hour.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { NudgePlan } from './schedule';

const CHANNEL_ID = 'reminders';

/** Tags every nudge this module owns, so cancelling never touches a notification someone else scheduled. */
const NUDGE_TAG = 'lustre.reminder.nudge';

const TITLE = 'Reminders pending';
const BODY = 'Reminders are waiting to be sent.';

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
    }),
});

let channelReady = false;

/**
 * Android needs a channel before anything can be posted to it, and the channel
 * is what the user tunes in system settings — so it is created once, named for
 * what it is rather than for the app.
 */
async function ensureChannel(): Promise<void> {
    if (channelReady || Platform.OS !== 'android') {
        channelReady = true;
        return;
    }

    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Appointment reminders',
        description: 'The daily nudge that reminders are still waiting to be sent.',
        importance: Notifications.AndroidImportance.DEFAULT,
    });
    channelReady = true;
}

/**
 * Asked for on the first arm — which, because the shell arms as soon as the two
 * queries answer, is a few seconds into the first launch. That is deliberate
 * rather than ideal: the alternative is arming nothing until someone visits
 * Settings → Reminders, and the 19:00 default is meant to work without anyone
 * going looking for it.
 *
 * A denial is final for the session. Re-asking every foreground is what teaches
 * someone to swat the prompt away, and Android stops showing it anyway. The way
 * back is Settings → Reminders, which says the OS is blocking it.
 */
async function ensurePermission(): Promise<boolean> {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;

    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
}

/** Whether the OS will let a nudge through right now. Asks nothing — a read, for the pane. */
export async function notificationsAllowed(): Promise<boolean> {
    return (await Notifications.getPermissionsAsync()).granted;
}

async function cancelNudges(): Promise<void> {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();

    await Promise.all(
        scheduled
            .filter((notification) => notification.content.data?.tag === NUDGE_TAG)
            .map((notification) => Notifications.cancelScheduledNotificationAsync(notification.identifier)),
    );
}

/**
 * Cancel what is armed and arm the plan. An empty plan is a cancel — that is the
 * whole of "stops when the list is cleared or dismissed for the day".
 *
 * Returns what it did, so the caller can hold "notifications are off" without
 * this module reaching for a logger the app does not have. Nothing in
 * `packages/app` writes to a console, and a nudge that did not arm is a thing to
 * say on screen rather than into a log nobody reads.
 */
export async function armNudges(plan: NudgePlan): Promise<'armed' | 'disarmed' | 'refused'> {
    await cancelNudges();

    if (plan.at.length === 0) return 'disarmed';
    if (!(await ensurePermission())) return 'refused';

    await ensureChannel();

    for (const at of plan.at) {
        await Notifications.scheduleNotificationAsync({
            content: { title: TITLE, body: BODY, data: { tag: NUDGE_TAG } },
            trigger: {
                type: Notifications.SchedulableTriggerInputTypes.DATE,
                date: at,
                channelId: CHANNEL_ID,
            },
        });
    }

    return 'armed';
}
