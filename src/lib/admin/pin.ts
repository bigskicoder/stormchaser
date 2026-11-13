import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getServiceDb } from "@/lib/db/client";

/**
 * Temporary PIN sign-in for /admin while Clerk isn't set up (Nick asked
 * 2026-11-13: "Just make it pin protected"). Once Clerk is configured it
 * takes over and the PIN is ignored.
 *
 * Where the PIN comes from: ADMIN_PIN in Vercel if set (Nick can change it
 * there), otherwise a salted scrypt hash in the private Storage object
 * admin-config/admin-pin.json, written by the "Set admin PIN" workflow
 * (Nick was on his phone and couldn't reach Vercel). The PIN itself is
 * never stored.
 *
 * A correct PIN sets an httpOnly cookie holding an expiry and an HMAC of
 * it keyed by the PIN's secret, so changing the PIN signs everyone out.
 * Wrong guesses are logged to cron_runs (job "admin_pin_failure", the
 * hashed IP in errors) because serverless instances share no memory; that
 * table is where the daily status report already looks for trouble.
 */

export const ADMIN_PIN_COOKIE = "ps_admin_pin";
export const ADMIN_PIN_SESSION_HOURS = 12;
export const PIN_FAIL_JOB = "admin_pin_failure";
/** Wrong guesses allowed per IP inside the window before that IP is locked out. */
export const PIN_MAX_FAILS_PER_IP = 5;
/** Wrong guesses allowed from everyone together inside the window, against guessing from many IPs. */
export const PIN_MAX_FAILS_TOTAL = 20;
export const PIN_LOCKOUT_MINUTES = 15;

export function clerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

export const PIN_BUCKET = "admin-config";
export const PIN_OBJECT = "admin-pin.json";

/** What a guess is checked against: the Vercel PIN, or the stored salted hash. */
export type PinSecret = { kind: "env"; pin: string } | { kind: "hash"; salt: string; hash: string };

export function hashPin(pin: string, salt = randomBytes(16).toString("hex")): { salt: string; hash: string } {
  return { salt, hash: scryptSync(pin.trim(), salt, 32).toString("hex") };
}

let cached: { at: number; secret: PinSecret | null } | null = null;

/** The active PIN secret, or null when PIN sign-in is off (Clerk set up, or no PIN anywhere). Cached for a minute. */
export async function getPinSecret(): Promise<PinSecret | null> {
  if (clerkConfigured()) return null;
  const envPin = process.env.ADMIN_PIN?.trim();
  if (envPin) return { kind: "env", pin: envPin };
  if (cached && Date.now() - cached.at < 60_000) return cached.secret;
  let secret: PinSecret | null = null;
  try {
    const { data } = await getServiceDb().storage.from(PIN_BUCKET).download(PIN_OBJECT);
    if (data) {
      const parsed = JSON.parse(await data.text()) as { salt?: unknown; hash?: unknown };
      if (typeof parsed.salt === "string" && typeof parsed.hash === "string" && parsed.hash.length === 64) {
        secret = { kind: "hash", salt: parsed.salt, hash: parsed.hash };
      }
    }
  } catch {
    secret = null;
  }
  cached = { at: Date.now(), secret };
  return secret;
}

function keyOf(secret: PinSecret): string {
  return secret.kind === "env" ? `env:${secret.pin}` : `hash:${secret.salt}:${secret.hash}`;
}

function sign(secret: PinSecret, expiresAt: number): string {
  return createHmac("sha256", `powder-seeker-admin:${keyOf(secret)}`).update(String(expiresAt)).digest("hex");
}

export function makeSessionToken(secret: PinSecret, now = Date.now()): { token: string; maxAgeSeconds: number } {
  const expiresAt = now + ADMIN_PIN_SESSION_HOURS * 3600_000;
  return { token: `${expiresAt}.${sign(secret, expiresAt)}`, maxAgeSeconds: ADMIN_PIN_SESSION_HOURS * 3600 };
}

function safeEqual(a: string, b: string): boolean {
  const ab = createHash("sha256").update(a).digest();
  const bb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ab, bb) && a.length === b.length;
}

export function verifySessionToken(secret: PinSecret, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [expRaw, mac] = token.split(".");
  const expiresAt = Number(expRaw);
  if (!mac || !Number.isFinite(expiresAt) || expiresAt <= now) return false;
  return safeEqual(mac, sign(secret, expiresAt));
}

export function pinMatches(secret: PinSecret, given: string): boolean {
  if (secret.kind === "env") return safeEqual(secret.pin, given.trim());
  return safeEqual(secret.hash, hashPin(given, secret.salt).hash);
}

/** Short one-way tag for an IP, so the log never stores the address itself. */
export function ipTag(ip: string): string {
  return `ip:${createHash("sha256").update(`powder-seeker:${ip}`).digest("hex").slice(0, 16)}`;
}

/**
 * True when this IP, or everyone together, has used up the wrong guesses for the window.
 * errors is jsonb, so the containment filter must be JSON ('["ip:..."]');
 * supabase-js's .contains() with an array sends a Postgres array literal
 * ('{ip:...}'), which jsonb rejects; that error made every PIN attempt fail
 * on 2026-11-13.
 */
export async function pinLockedOut(tag: string): Promise<boolean> {
  const db = getServiceDb();
  const since = new Date(Date.now() - PIN_LOCKOUT_MINUTES * 60_000).toISOString();
  const [mine, all] = await Promise.all([
    db.from("cron_runs").select("id", { count: "exact", head: true }).eq("job", PIN_FAIL_JOB).gte("ran_at", since).filter("errors", "cs", JSON.stringify([tag])),
    db.from("cron_runs").select("id", { count: "exact", head: true }).eq("job", PIN_FAIL_JOB).gte("ran_at", since),
  ]);
  if (mine.error) throw mine.error;
  if (all.error) throw all.error;
  return (mine.count ?? 0) >= PIN_MAX_FAILS_PER_IP || (all.count ?? 0) >= PIN_MAX_FAILS_TOTAL;
}

export async function recordPinFailure(tag: string): Promise<void> {
  const { error } = await getServiceDb().from("cron_runs").insert({ job: PIN_FAIL_JOB, error_count: 1, errors: [tag] });
  if (error) throw error;
}
