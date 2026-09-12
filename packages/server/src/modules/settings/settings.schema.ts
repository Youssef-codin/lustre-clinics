/**
 * SPEC §12 — everything the clinic can configure is a row here, edited in-app.
 * `.env` holds only what a user must never touch.
 *
 * Postgres `time` accepts `HH:MM:SS` and returns it, so `reminderNotifyAt`
 * tolerates both but the client reads `HH:MM`. Weekdays are 0 = Sunday, matching
 * `Date#getDay`. Opening times are `HH:MM` exactly — accepting seconds would
 * store a value that never survives a round trip and echoing a day back into
 * `setDay` would silently shift it; both are zero-padded, so comparing them as
 * strings orders them by time.
 */
import { MAX_DURATION_MINUTES, MIN_DURATION_MINUTES } from '@lustre/shared';
import { z } from 'zod';

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'expected HH:MM');

const duration = z.number().int().min(MIN_DURATION_MINUTES).max(MAX_DURATION_MINUTES);

export const updateSettingsInput = z
    .object({
        clinicName: z.string().trim().min(1).max(120),
        clinicPhone: z.string().trim().max(40).nullable(),
        durationOptions: z.array(duration).min(1).max(12),
        defaultDuration: duration,
        reminderLeadHours: z
            .number()
            .int()
            .min(0)
            .max(24 * 14),
        reminderNotifyAt: timeOfDay,
        reminderRepeatMinutes: z
            .number()
            .int()
            .min(1)
            .max(24 * 60),
        reminderTemplate: z.string().trim().min(1).max(1000),
    })
    .partial()
    .refine((v) => Object.keys(v).length > 0, 'nothing to update');

export type UpdateSettingsInput = z.infer<typeof updateSettingsInput>;

const weekday = z.number().int().min(0).max(6);

const openingTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

export const setClinicDayInput = z
    .object({
        weekday,
        branchId: z.uuid(),
        opensAt: openingTime,
        closesAt: openingTime,
    })
    .refine((v) => v.opensAt < v.closesAt, {
        message: 'opensAt must be before closesAt',
        path: ['closesAt'],
    });

export const clearClinicDayInput = z.object({ weekday });

export type SetClinicDayInput = z.infer<typeof setClinicDayInput>;
