/**
 * Stores the admin PIN's salted hash in the private Storage object
 * admin-config/admin-pin.json (read by src/lib/admin/pin.ts), without the
 * PIN or a crackable hash of it ever appearing in this public repo or its
 * public Actions logs. Two steps, each one run of the "Set admin PIN"
 * workflow:
 *
 *   keygen  makes a one-time RSA key pair, keeps the private half in the
 *           private bucket, and prints the public half.
 *   store   takes the PIN encrypted to that public key (base64 RSA-OAEP),
 *           decrypts it here, writes the salted scrypt hash, and deletes the
 *           private key so the ciphertext is useless afterwards.
 *
 *   npx tsx scripts/set-admin-pin.ts keygen
 *   npx tsx scripts/set-admin-pin.ts store <base64-ciphertext>
 *
 * ADMIN_PIN set in Vercel overrides whatever is stored here.
 */

import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { getServiceDb } from "../src/lib/db/client";
import { PIN_BUCKET, PIN_OBJECT, hashPin } from "../src/lib/admin/pin";

const KEY_OBJECT = "pin-key.pem";

async function ensureBucket() {
  const db = getServiceDb();
  const { data } = await db.storage.getBucket(PIN_BUCKET);
  if (data) return;
  const { error } = await db.storage.createBucket(PIN_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
}

async function keygen() {
  await ensureBucket();
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const { error } = await getServiceDb().storage.from(PIN_BUCKET).upload(KEY_OBJECT, pem, { contentType: "text/plain", upsert: true });
  if (error) throw error;
  console.log("PUBLIC KEY (encrypt the PIN to this with RSA-OAEP SHA-256):");
  console.log(publicKey.export({ type: "spki", format: "pem" }));
}

async function store(ciphertext: string) {
  const db = getServiceDb();
  const { data, error } = await db.storage.from(PIN_BUCKET).download(KEY_OBJECT);
  if (error || !data) throw new Error("No pending key: run the keygen step first.");
  const pin = privateDecrypt(
    { key: await data.text(), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(ciphertext.trim(), "base64")
  ).toString("utf8").trim();
  if (!/^\d{4,12}$/.test(pin)) throw new Error("Decrypted PIN isn't 4-12 digits; nothing stored.");
  const { salt, hash } = hashPin(pin);
  const up = await db.storage.from(PIN_BUCKET).upload(PIN_OBJECT, JSON.stringify({ salt, hash, set_at: new Date().toISOString() }), {
    contentType: "application/json",
    upsert: true,
  });
  if (up.error) throw up.error;
  const rm = await db.storage.from(PIN_BUCKET).remove([KEY_OBJECT]);
  if (rm.error) throw rm.error;
  console.log("Admin PIN hash stored; one-time key deleted.");
}

const [step, arg] = process.argv.slice(2);
(step === "keygen" ? keygen() : step === "store" && arg ? store(arg) : Promise.reject(new Error("usage: keygen | store <ciphertext>"))).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
