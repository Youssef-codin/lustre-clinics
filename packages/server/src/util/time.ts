/**
 * Time helpers. Every timestamp in the database is `timestamptz` (SPEC §5), so
 * these deal in absolute instants; a calendar day is only ever a day *for
 * somebody*, which is why the day-range helper takes the offset explicitly
 * rather than reading the server's own timezone.
 */

export function ageFromBirthDate(birthDate: string | null, on: Date = new Date()): number | null {
    if (!birthDate) return null;

    const born = new Date(`${birthDate}T00:00:00Z`);
    if (Number.isNaN(born.getTime())) return null;

    let age = on.getUTCFullYear() - born.getUTCFullYear();
    const monthDiff = on.getUTCMonth() - born.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && on.getUTCDate() < born.getUTCDate())) {
        age -= 1;
    }
    return age < 0 ? null : age;
}

export function dayRange(date: string, offsetMinutes = 0): { from: Date; to: Date } {
    const startUtc = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(startUtc.getTime())) {
        throw new Error(`invalid date: ${date}`);
    }

    const from = new Date(startUtc.getTime() - offsetMinutes * 60_000);
    const to = new Date(from.getTime() + 86_400_000);
    return { from, to };
}

export function refDatePart(at: Date, offsetMinutes = 0): string {
    const local = new Date(at.getTime() + offsetMinutes * 60_000);
    const dd = String(local.getUTCDate()).padStart(2, '0');
    const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
    const yy = String(local.getUTCFullYear() % 100).padStart(2, '0');
    return `${dd}${mm}${yy}`;
}
