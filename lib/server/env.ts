import { z } from "zod";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().min(1),
  // Pusher is optional. When all four are set, realtime is delivered over
  // Pusher; when absent, the client falls back to polling. See hasPusher().
  PUSHER_APP_ID: z.string().min(1).optional(),
  PUSHER_KEY: z.string().min(1).optional(),
  PUSHER_SECRET: z.string().min(1).optional(),
  PUSHER_CLUSTER: z.string().min(1).optional(),
  SESSION_SIGNING_SECRET: z.string().min(32),
  IP_HMAC_SECRET: z.string().min(32),
  CRON_SECRET: z.string().min(16),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

const TEST_DEFAULTS: ServerEnv = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  BLOB_READ_WRITE_TOKEN: "test-token",
  PUSHER_APP_ID: "test",
  PUSHER_KEY: "test-key",
  PUSHER_SECRET: "test-secret",
  PUSHER_CLUSTER: "eu",
  SESSION_SIGNING_SECRET: "test-session-signing-secret-0123456789abcdef",
  IP_HMAC_SECRET: "test-ip-hmac-secret-0123456789abcdefghijkl",
  CRON_SECRET: "test-cron-secret-000000",
};

export function isTestEnv(): boolean {
  return (
    process.env.NODE_ENV === "test" || process.env.WAWE_TEST_MODE === "1"
  );
}

/**
 * True when a full set of Pusher credentials is configured. When false, the
 * server skips realtime triggers and the client polls for updates instead.
 */
export function hasPusher(): boolean {
  if (isTestEnv()) return true;
  const env = serverEnv();
  return Boolean(
    env.PUSHER_APP_ID &&
      env.PUSHER_KEY &&
      env.PUSHER_SECRET &&
      env.PUSHER_CLUSTER,
  );
}

let cached: ServerEnv | null = null;

/**
 * Validates server environment variables once and fails loudly with the name
 * of every missing variable instead of breaking silently in production.
 */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  if (isTestEnv()) {
    cached = { ...TEST_DEFAULTS, ...pickPresent() };
    return cached;
  }
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(
      `Missing required server environment variable: ${missing}`,
    );
  }
  cached = parsed.data;
  return cached;
}

function pickPresent(): Partial<ServerEnv> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(serverEnvSchema.shape)) {
    const value = process.env[key];
    if (value) out[key] = value;
  }
  return out as Partial<ServerEnv>;
}
