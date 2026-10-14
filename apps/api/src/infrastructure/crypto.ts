import { scryptAsync } from "@noble/hashes/scrypt.js";
import type { AuthCrypto } from "../modules/auth/usecase";

const SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 5,
  dkLen: 32,
  maxmem: 32 * 1024 * 1024,
};

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function fromHex(hex: string) {
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

export function randomToken() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string) {
  return toHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
  );
}

export async function secureEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([
    hashToken(left),
    hashToken(right),
  ]);
  let difference = 0;
  for (let index = 0; index < leftHash.length; index++) {
    difference |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index);
  }

  return difference === 0;
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await scryptAsync(password, salt, SCRYPT_OPTIONS);
  return `scrypt-v1:${toHex(salt)}:${toHex(hash)}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string | undefined,
) {
  const parsed = /^scrypt-v1:([a-f0-9]{32}):([a-f0-9]{64})$/.exec(
    storedHash ?? "",
  );
  // Unknown accounts take the same KDF path; the timing must not disclose existence.
  const salt = fromHex(parsed?.[1] ?? "0".repeat(32));
  const actual = toHex(await scryptAsync(password, salt, SCRYPT_OPTIONS));
  const isEqual = await secureEqual(actual, parsed?.[2] ?? "0".repeat(64));
  return Boolean(parsed) && isEqual;
}

export const AUTH_CRYPTO: AuthCrypto = {
  hashPassword,
  hashToken,
  randomToken,
  verifyPassword,
};

export async function encryptProfile(plaintext: string, keyHex: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    fromHex(keyHex),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `v1.${toHex(iv)}.${toHex(new Uint8Array(ciphertext))}`;
}

export async function decryptProfile(encrypted: string, keyHex: string) {
  const parsed = /^v1\.([a-f0-9]{24})\.([a-f0-9]+)$/.exec(encrypted);
  if (!parsed?.[1] || !parsed[2])
    throw new Error("Invalid encrypted profile format");

  const key = await crypto.subtle.importKey(
    "raw",
    fromHex(keyHex),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromHex(parsed[1]) },
    key,
    fromHex(parsed[2]),
  );
  return new TextDecoder().decode(plaintext);
}
