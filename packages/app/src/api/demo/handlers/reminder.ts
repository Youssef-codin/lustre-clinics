/**
 * `server/src/modules/reminder/reminder.service.ts`. Nothing is sent
 * automatically (§11): a row is created on booking, the screen lists what is
 * pending, and the user marks each one sent or skipped after opening WhatsApp.
 *
 * A cancelled appointment's reminder is marked skipped rather than removed —
 * the row is the record that no message was owed, and one reminder belongs to
 * one appointment, so a later reinstatement reuses it.
 */
import { REMINDER_PLACEHOLDERS } from '@lustre/shared';
import type { RouterInput, RouterOutput } from '../../types';
import { type AppointmentRow, getDb, type ReminderRow, save } from '../db';
import { DemoError, toWhatsAppNumber, uuidv7 } from '../rules';
import type { Dated } from '../wire';
import { settingsHandlers } from './settings';

type PendingReminder = Dated<RouterOutput['reminder']['pending'][number]>;

/** An unrecognized `{{placeholder}}` is left visible, so a typo shows rather than vanishing. */
function renderTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) =>
        (REMINDER_PLACEHOLDERS as readonly string[]).includes(key) ? (values[key] ?? whole) : whole,
    );
}

export function scheduleReminderFor(appointment: AppointmentRow, leadHours: number): void {
    const db = getDb();
    const dueAt = new Date(appointment.startsAt.getTime() - leadHours * 3_600_000);

    const existing = db.reminders.find((row) => row.appointmentId === appointment.id);
    if (existing) {
        existing.dueAt = dueAt;
        return;
    }

    db.reminders.push({
        id: uuidv7(),
        appointmentId: appointment.id,
        dueAt,
        status: 'pending',
        sentAt: null,
    });
}

export function rescheduleReminder(appointmentId: string, startsAt: Date): void {
    const { reminderLeadHours } = settingsHandlers.get();
    const row = getDb().reminders.find((reminder) => reminder.appointmentId === appointmentId);
    if (row) row.dueAt = new Date(startsAt.getTime() - reminderLeadHours * 3_600_000);
}

export function skipReminderFor(appointmentId: string): void {
    const row = getDb().reminders.find((reminder) => reminder.appointmentId === appointmentId);
    if (row?.status === 'pending') row.status = 'skipped';
}

function requireReminder(id: string): ReminderRow {
    const row = getDb().reminders.find((reminder) => reminder.id === id);
    if (!row) throw DemoError.notFound('reminder');
    return row;
}

export const reminderHandlers = {
    pending(input: RouterInput['reminder']['pending']): PendingReminder[] {
        const db = getDb();
        const settings = settingsHandlers.get();

        const dueOnly = input?.dueOnly ?? true;
        const limit = input?.limit ?? 100;
        const offsetMinutes = input?.offsetMinutes ?? 0;
        const now = new Date();

        return db.reminders
            .filter((reminder) => reminder.status === 'pending')
            .filter((reminder) => !dueOnly || reminder.dueAt <= now)
            .map((reminder) => ({
                reminder,
                appointment: db.appointments.find((row) => row.id === reminder.appointmentId),
            }))
            .filter(
                (pair): pair is { reminder: ReminderRow; appointment: AppointmentRow } =>
                    pair.appointment?.status === 'booked',
            )
            .sort((a, b) => a.reminder.dueAt.getTime() - b.reminder.dueAt.getTime())
            .slice(0, limit)
            .map(({ reminder, appointment }) => {
                const patient = db.patients.find((row) => row.id === appointment.patientId);
                const name = patient?.name ?? '';
                const phone = patient?.phone ?? '';

                // `startsAt` is UTC, so the quoted date and time are shifted
                // into the clinic's local day before they are formatted.
                const local = new Date(appointment.startsAt.getTime() + offsetMinutes * 60_000);

                const message = renderTemplate(settings.reminderTemplate, {
                    name,
                    clinic: settings.clinicName,
                    date: local.toISOString().slice(0, 10),
                    time: local.toISOString().slice(11, 16),
                    ref: appointment.ref,
                });

                return {
                    id: reminder.id,
                    appointmentId: reminder.appointmentId,
                    dueAt: reminder.dueAt,
                    startsAt: appointment.startsAt,
                    ref: appointment.ref,
                    patient: { id: appointment.patientId, name, phone },
                    whatsAppUrl: `https://wa.me/${toWhatsAppNumber(phone)}?text=${encodeURIComponent(message)}`,
                    message,
                };
            });
    },

    markSent(input: RouterInput['reminder']['markSent']): Dated<RouterOutput['reminder']['markSent']> {
        const row = requireReminder(input.id);
        row.status = 'sent';
        row.sentAt = new Date();

        save();
        return row;
    },

    markSkipped(
        input: RouterInput['reminder']['markSkipped'],
    ): Dated<RouterOutput['reminder']['markSkipped']> {
        const row = requireReminder(input.id);
        row.status = 'skipped';

        save();
        return row;
    },

    dismissToday(
        input: RouterInput['reminder']['dismissToday'],
    ): Dated<RouterOutput['reminder']['dismissToday']> {
        // `dismissRemindersFor` broadcasts `SETTINGS_UPDATED` itself; saying it
        // again here makes every subscriber refetch twice for one dismissal.
        return settingsHandlers.dismissRemindersFor(input.date);
    },
};
