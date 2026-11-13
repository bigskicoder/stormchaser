import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_PIN_COOKIE,
  getPinSecret,
  ipTag,
  makeSessionToken,
  pinLockedOut,
  pinMatches,
  recordPinFailure,
  PIN_LOCKOUT_MINUTES,
} from "@/lib/admin/pin";

export const dynamic = "force-dynamic";

/** PIN sign-in for /admin (see lib/admin/pin.ts). Lives outside /api/admin so it isn't itself behind the admin check. */
export async function POST(req: NextRequest) {
  const secret = await getPinSecret();
  if (!secret) return NextResponse.json({ error: "PIN sign-in is off." }, { status: 404 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const tag = ipTag(ip);
  // If the lockout check itself fails (database hiccup), still allow the
  // attempt: the PIN is checked either way, and a broken check must not
  // lock the owner out.
  const lockedOut = await pinLockedOut(tag).catch((err) => {
    console.error("admin PIN lockout check failed", err);
    return false;
  });
  if (lockedOut) {
    return NextResponse.json({ error: `Too many wrong PINs. Try again in ${PIN_LOCKOUT_MINUTES} minutes.` }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { pin?: unknown };
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!pin || !pinMatches(secret, pin)) {
    await recordPinFailure(tag).catch((err) => console.error("admin PIN failure log failed", err));
    return NextResponse.json({ error: "Wrong PIN." }, { status: 401 });
  }

  const { token, maxAgeSeconds } = makeSessionToken(secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_PIN_COOKIE, token, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: maxAgeSeconds });
  return res;
}

/** Sign out. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_PIN_COOKIE, "", { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}
