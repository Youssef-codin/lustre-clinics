/**
 * Demo mode: the clinic server, in memory, on the phone.
 *
 * `../client` splits on `isDemoMode()` per request, so nothing else in the app
 * knows this exists — the screens call the same procedures over the same client
 * and get the same shapes back.
 */
export { subscribeToDemoEvents } from './events';
export type { DemoMode } from './flag';
export { enableDemoMode, isDemoMode, useDemoMode } from './flag';
export { demoLink } from './link';

import { noteDataReset } from '../dataReset';
import { clearStored, setDb } from './db';
import { seedDemoDb } from './seed';

/**
 * Back to the clinic the demo opens on. Worth having on the settings screen:
 * a demo is given more than once, and the second run should not start on the
 * first one's cancellations.
 */
export async function resetDemoData(): Promise<void> {
    await clearStored();
    setDb(seedDemoDb());
    noteDataReset();
}
