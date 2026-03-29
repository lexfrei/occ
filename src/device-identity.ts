/**
 * Ed25519 device identity for OpenClaw Gateway WebSocket authentication.
 *
 * Generates a key pair on first run, persists to ~/.config/occ/device-keys.json,
 * and signs v3 challenge payloads for the connect handshake.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const KEYS_DIR = path.join(homedir(), ".config", "occ");
const KEYS_FILE = path.join(KEYS_DIR, "device-keys.json");

const PLATFORM = process.platform === "darwin" ? "macos" : process.platform;

interface StoredKeys {
  readonly publicKeyBase64Url: string;
  readonly privateKeyBase64Url: string;
  readonly deviceId: string;
}

interface DeviceIdentity {
  readonly publicKeyBase64Url: string;
  readonly deviceId: string;
  readonly signingKey: CryptoKey;
}

function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const binary = String.fromCodePoint(...bytes);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(encoded: string): Uint8Array {
  const padded = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    const code = binary.codePointAt(index);

    if (code === undefined) {
      throw new Error(`Unexpected undefined codepoint at index ${String(index)}`);
    }

    bytes[index] = code;
  }

  return bytes;
}

async function importPrivateKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", raw.buffer as ArrayBuffer, "Ed25519", false, ["sign"]);
}

async function generateKeyPair(): Promise<DeviceIdentity> {
  const keyPair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;

  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const privateKeyPkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
  );

  const publicKeyBase64Url = base64UrlEncode(publicKeyRaw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", publicKeyRaw);
  const hashArray = new Uint8Array(hashBuffer);
  const deviceId = [...hashArray].map((byte) => byte.toString(16).padStart(2, "0")).join("");

  const stored: StoredKeys = {
    publicKeyBase64Url,
    privateKeyBase64Url: base64UrlEncode(privateKeyPkcs8),
    deviceId,
  };

  await mkdir(KEYS_DIR, { recursive: true, mode: 0o700 });
  await writeFile(KEYS_FILE, JSON.stringify(stored, null, 2), { mode: 0o600 });

  console.error(`[occ] generated new device identity: ${deviceId.slice(0, 12)}...`);

  return { publicKeyBase64Url, deviceId, signingKey: keyPair.privateKey };
}

async function loadKeyPair(): Promise<DeviceIdentity> {
  const content = await readFile(KEYS_FILE, "utf8");
  const raw: unknown = JSON.parse(content);

  if (
    typeof raw !== "object" ||
    raw === null ||
    !("publicKeyBase64Url" in raw) ||
    !("privateKeyBase64Url" in raw) ||
    !("deviceId" in raw) ||
    typeof (raw as StoredKeys).publicKeyBase64Url !== "string" ||
    typeof (raw as StoredKeys).privateKeyBase64Url !== "string" ||
    typeof (raw as StoredKeys).deviceId !== "string"
  ) {
    throw new Error("Invalid device keys file format");
  }

  const stored = raw as StoredKeys;
  const signingKey = await importPrivateKey(base64UrlDecode(stored.privateKeyBase64Url));

  return { publicKeyBase64Url: stored.publicKeyBase64Url, deviceId: stored.deviceId, signingKey };
}

/** Load existing device identity or generate a new one. */
export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  try {
    return await loadKeyPair();
  } catch {
    console.error("[occ] generating new device keys");
    return generateKeyPair();
  }
}

/**
 * Sign the v3 challenge payload.
 * Format: v3|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce|platform|deviceFamily
 */
export async function signChallenge(
  identity: DeviceIdentity,
  nonce: string,
  token: string,
): Promise<{ signature: string; signedAt: number }> {
  const signedAt = Date.now();

  const payload = [
    "v3",
    identity.deviceId,
    "occ",
    "backend",
    "operator",
    "operator.read,operator.write",
    String(signedAt),
    token,
    nonce,
    PLATFORM,
    "",
  ].join("|");

  const payloadBytes = new TextEncoder().encode(payload) as Uint8Array<ArrayBuffer>;
  const signatureBuffer = await crypto.subtle.sign("Ed25519", identity.signingKey, payloadBytes);

  return { signature: base64UrlEncode(signatureBuffer), signedAt };
}
