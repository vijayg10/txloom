import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// D14: sink credentials encrypt with AES-256-GCM under a per-install key
// generated on first boot into the data volume (overridable via env var).

const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce size
const ALGORITHM = "aes-256-gcm";

export function instanceKeyPath(dataDir: string): string {
  return path.join(dataDir, "keys", "instance.key");
}

/** Returns the instance key, generating and persisting one on first boot if none
 * exists yet. `TXLOOM_INSTANCE_KEY` (hex-encoded, 32 bytes) overrides the file. */
export function getOrCreateInstanceKey(dataDir: string): Buffer {
  const envKey = process.env.TXLOOM_INSTANCE_KEY;
  if (envKey) {
    const buf = Buffer.from(envKey, "hex");
    if (buf.length !== KEY_BYTES) {
      throw new Error(
        `TXLOOM_INSTANCE_KEY must be ${KEY_BYTES} bytes hex-encoded, got ${buf.length}`,
      );
    }
    return buf;
  }

  const keyPath = instanceKeyPath(dataDir);
  if (existsSync(keyPath)) {
    return Buffer.from(readFileSync(keyPath, "utf-8").trim(), "hex");
  }

  const key = randomBytes(KEY_BYTES);
  mkdirSync(path.dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, key.toString("hex"), { mode: 0o600 });
  return key;
}

/** AES-256-GCM envelope: iv (12B) || authTag (16B) || ciphertext, base64-free — stored
 * directly in sink_connections.credentials_enc (varbinary). */
export function encryptSecret(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decryptSecret(envelope: Buffer, key: Buffer): string {
  const iv = envelope.subarray(0, IV_BYTES);
  const authTag = envelope.subarray(IV_BYTES, IV_BYTES + 16);
  const ciphertext = envelope.subarray(IV_BYTES + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}
