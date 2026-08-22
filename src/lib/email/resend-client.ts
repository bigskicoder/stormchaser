import { Resend } from "resend";

let client: Resend | null = null;

export function getResendClient(): Resend {
  if (client) return client;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Missing RESEND_API_KEY env var");
  client = new Resend(key);
  return client;
}

export const ALERTS_FROM_EMAIL = process.env.ALERTS_FROM_EMAIL ?? "alerts@example.com";
