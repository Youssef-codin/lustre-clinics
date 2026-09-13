/**
 * `.env` holds only non-user-editable values (SPEC §12). Everything the clinic
 * can change is a row in `settings` and is edited in-app.
 *
 * The heartbeat is outbound: nothing can reach the clinic machine from outside
 * the tailnet, so the server pings `HEARTBEAT_URL` and the monitor alerts on
 * silence (§17). `BACKUP_ENCRYPTION_KEY` (32 bytes, hex/base64) is NOT stored on
 * the clinic machine; off-site upload is refused without it and local dumps are
 * unencrypted. Drive backups use a service account and need a shared-drive
 * folder or a `BACKUP_DRIVE_SUBJECT` to impersonate. Drive wins over S3 when
 * both are configured.
 */
import { z } from 'zod';

const envSchema = z.object({
    DATABASE_URL: z.string().min(1),
    // On the clinic machine the server connects as `lustre_app`, which cannot
    // change the schema, so migrations need the owner role's URL. Production
    // leaves MIGRATE_ON_BOOT off and never hands the server that URL at all:
    // migrations run as their own deploy step (infra/README.md).
    MIGRATION_DATABASE_URL: z
        .string()
        .min(1)
        .optional()
        .or(z.literal('').transform(() => undefined)),
    MIGRATE_ON_BOOT: z.stringbool().default(true),
    // The compiled binary carries no files beside its own code, so the image
    // ships the SQL folder and points here. Unset, migrations are read from
    // next to the schema in the source tree.
    MIGRATIONS_DIR: z.string().min(1).optional(),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DISCORD_WEBHOOK_URL: z
        .url()
        .optional()
        .or(z.literal('').transform(() => undefined)),
    HEARTBEAT_URL: z
        .url()
        .optional()
        .or(z.literal('').transform(() => undefined)),
    HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),

    // Where this machine answers from elsewhere on the tailnet. Reported to the
    // app by `health.check` so a phone is never told it by hand (§14).
    // `TAILSCALE_IP` is already required by compose to bind the published port.
    TAILSCALE_HOSTNAME: z.string().optional(),
    TAILSCALE_IP: z.string().optional(),

    BACKUP_ENCRYPTION_KEY: z.string().optional(),
    BACKUP_DIR: z.string().default('./backups'),
    BACKUP_INTERVAL_HOURS: z.coerce.number().positive().default(24),
    BACKUP_STALE_AFTER_HOURS: z.coerce.number().positive().default(48),
    PG_BIN_DIR: z.string().optional(),

    BACKUP_DRIVE_FOLDER_ID: z.string().optional(),
    BACKUP_DRIVE_CLIENT_EMAIL: z.string().optional(),
    BACKUP_DRIVE_PRIVATE_KEY: z.string().optional(),
    BACKUP_DRIVE_SUBJECT: z.string().optional(),

    BACKUP_S3_BUCKET: z.string().optional(),
    BACKUP_S3_ENDPOINT: z.string().optional(),
    BACKUP_S3_REGION: z.string().optional(),
    BACKUP_S3_ACCESS_KEY_ID: z.string().optional(),
    BACKUP_S3_SECRET_ACCESS_KEY: z.string().optional(),
    BACKUP_S3_PREFIX: z.string().default('lustre'),
});

export type Config = z.infer<typeof envSchema>;

function load(): Config {
    const parsed = envSchema.safeParse(Bun.env);
    if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
        throw new Error(`Invalid environment:\n${issues}`);
    }
    return parsed.data;
}

export const config = load();

// A tailnet address is in the 100.64.0.0/10 carrier-grade NAT range Tailscale
// hands out. The check exists to reject `TAILSCALE_IP`'s dev default of
// 0.0.0.0, which binds every interface and dials none of them: handing it to a
// phone would store a working-looking address that can never answer.
function isTailnetIp(value: string): boolean {
    const [first, second] = value.split('.').map(Number);
    return first === 100 && second !== undefined && second >= 64 && second <= 127;
}

function asBaseUrl(host: string, port: number): string {
    const trimmed = host.trim().replace(/\/+$/, '');
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    // A bare MagicDNS name or IP carries no port, and the one worth advertising
    // is the one this process is listening on.
    return trimmed.includes(':') ? `http://${trimmed}` : `http://${trimmed}:${port}`;
}

// The MagicDNS name is preferred over the IP because it survives the tailnet
// reassigning the address — the phones then need no attention at all.
// Exported for the tests: what it returns is written into every handset, so a
// wrong answer here is not a bad response but a fleet that cannot dial home.
export function resolveTailnetAddress(env: Config): string | null {
    const hostname = env.TAILSCALE_HOSTNAME?.trim();
    if (hostname) return asBaseUrl(hostname, env.PORT);

    const ip = env.TAILSCALE_IP?.trim();
    return ip && isTailnetIp(ip) ? asBaseUrl(ip, env.PORT) : null;
}

export const tailnetAddress = resolveTailnetAddress(config);
