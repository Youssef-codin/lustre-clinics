/**
 * SPEC §12. One enforced row (§5), seeded on first read so a fresh database is
 * usable without a manual step.
 *
 * `reminder_dismissed_on` lives here too (§11): the daily notification's repeat
 * is suppressed while it equals today. Reminder logic reads it through this
 * service rather than touching the row itself.
 *
 * Postgres returns `time` as `HH:MM:SS`, so rows are trimmed to `HH:MM` for the
 * client. Seeding uses `onConflictDoNothing` to cover two boots racing on an
 * empty database. `defaultDuration` must stay inside `durationOptions` or the
 * picker would offer an unpickable default, and `setDay` resolves the branch
 * first so the client gets a localizable `NOT_FOUND` rather than a foreign-key
 * violation.
 */
import { DEFAULT_CLINIC_NAME, DEFAULT_REMINDER_TEMPLATE, ERROR_CODE, WS_EVENT } from '@lustre/shared';
import { asc, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { clinicDays, settings } from '../../db/schema.ts';
import { AppError } from '../../errors/AppError.ts';
import { broadcast } from '../../ws/index.ts';
import { branchService } from '../branch/branch.service.ts';
import type { SetClinicDayInput, UpdateSettingsInput } from './settings.schema.ts';

interface Settings {
    clinicName: string;
    clinicPhone: string | null;
    durationOptions: number[];
    defaultDuration: number;
    reminderLeadHours: number;
    reminderNotifyAt: string;
    reminderRepeatMinutes: number;
    reminderDismissedOn: string | null;
    reminderTemplate: string;
    updatedAt: Date;
}

type SettingsRow = typeof settings.$inferSelect;

function toSettings(row: SettingsRow): Settings {
    return {
        clinicName: row.clinicName,
        clinicPhone: row.clinicPhone,
        durationOptions: [...row.durationOptions].sort((a, b) => a - b),
        defaultDuration: row.defaultDuration,
        reminderLeadHours: row.reminderLeadHours,
        reminderNotifyAt: row.reminderNotifyAt.slice(0, 5),
        reminderRepeatMinutes: row.reminderRepeatMinutes,
        reminderDismissedOn: row.reminderDismissedOn,
        reminderTemplate: row.reminderTemplate,
        updatedAt: row.updatedAt,
    };
}

async function readRow(): Promise<SettingsRow> {
    const [existing] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
    if (existing) return existing;

    await db
        .insert(settings)
        .values({ id: 1, clinicName: DEFAULT_CLINIC_NAME, reminderTemplate: DEFAULT_REMINDER_TEMPLATE })
        .onConflictDoNothing();

    const [seeded] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
    if (!seeded) throw AppError.internal('settings row could not be seeded');
    return seeded;
}

interface ClinicDay {
    weekday: number;
    branchId: string;
    opensAt: string;
    closesAt: string;
}

type ClinicDayRow = typeof clinicDays.$inferSelect;

function toClinicDay(row: ClinicDayRow): ClinicDay {
    return {
        weekday: row.weekday,
        branchId: row.branchId,
        opensAt: row.opensAt.slice(0, 5),
        closesAt: row.closesAt.slice(0, 5),
    };
}

export const settingsService = {
    async get(): Promise<Settings> {
        return toSettings(await readRow());
    },

    async ensureSeeded(): Promise<void> {
        await readRow();
    },

    async update(input: UpdateSettingsInput): Promise<Settings> {
        const current = await readRow();

        const durationOptions = input.durationOptions
            ? [...new Set(input.durationOptions)].sort((a, b) => a - b)
            : [...current.durationOptions].sort((a, b) => a - b);
        const defaultDuration = input.defaultDuration ?? current.defaultDuration;

        if (!durationOptions.includes(defaultDuration)) {
            throw new AppError(
                ERROR_CODE.INVALID_DURATION,
                'defaultDuration must be one of durationOptions',
                422,
            );
        }

        const [updated] = await db
            .update(settings)
            .set({
                ...input,
                durationOptions,
                defaultDuration,
                updatedAt: new Date(),
            })
            .where(eq(settings.id, 1))
            .returning();

        if (!updated) throw AppError.notFound('settings');

        broadcast(WS_EVENT.SETTINGS_UPDATED);
        return toSettings(updated);
    },

    async schedule(): Promise<ClinicDay[]> {
        const rows = await db.select().from(clinicDays).orderBy(asc(clinicDays.weekday));
        return rows.map(toClinicDay);
    },

    async dayFor(weekday: number): Promise<ClinicDay | null> {
        const [row] = await db.select().from(clinicDays).where(eq(clinicDays.weekday, weekday)).limit(1);
        return row ? toClinicDay(row) : null;
    },

    async setDay(input: SetClinicDayInput): Promise<ClinicDay> {
        await branchService.byId(input.branchId);

        const [row] = await db
            .insert(clinicDays)
            .values(input)
            .onConflictDoUpdate({
                target: clinicDays.weekday,
                set: { branchId: input.branchId, opensAt: input.opensAt, closesAt: input.closesAt },
            })
            .returning();

        if (!row) throw AppError.internal('clinic day upsert returned nothing');

        broadcast(WS_EVENT.SETTINGS_UPDATED);
        return toClinicDay(row);
    },

    async clearDay(weekday: number): Promise<void> {
        await db.delete(clinicDays).where(eq(clinicDays.weekday, weekday));
        broadcast(WS_EVENT.SETTINGS_UPDATED);
    },

    async dismissRemindersFor(date: string): Promise<Settings> {
        await readRow();

        const [updated] = await db
            .update(settings)
            .set({ reminderDismissedOn: date, updatedAt: new Date() })
            .where(eq(settings.id, 1))
            .returning();

        if (!updated) throw AppError.notFound('settings');

        broadcast(WS_EVENT.SETTINGS_UPDATED);
        return toSettings(updated);
    },
};
