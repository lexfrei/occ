/**
 * Ed25519 device identity for OpenClaw Gateway WebSocket authentication.
 *
 * Generates a key pair on first run, persists it, and signs
 * the v3 challenge payload for the connect handshake.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const KEYS_DIR = path.join(homedir(), ".config", "occ");
const KEYS_FILE = path.join(KEYS_DIR, "device-keys.json");

interface StoredKeys {
  readonly publicKeyBase64Url: string;
  readonly privateKeyBase64Url: string;
  readonly deviceId: string;
}

interface DeviceIdentity {
  readonly publicKeyBase64Url: string;
  readonly privateKeyRaw: Uint8Array;
  readonly deviceId: string;
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
    bytes[index] = binary.codePointAt(index) ?? 0;
  }
  return bytes;
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

  mkdirSync(KEYS_DIR, { recursive: true });
  writeFileSync(KEYS_FILE, JSON.stringify(stored, null, 2), { mode: 0o600 });

  console.error(`[occ] generated new device identity: ${deviceId.slice(0, 12)}...`);

  return {
    publicKeyBase64Url,
    privateKeyRaw: privateKeyPkcs8,
    deviceId,
  };
}

function loadKeyPair(): DeviceIdentity {
  const stored = JSON.parse(readFileSync(KEYS_FILE, "utf8")) as StoredKeys;

  return {
    publicKeyBase64Url: stored.publicKeyBase64Url,
    privateKeyRaw: base64UrlDecode(stored.privateKeyBase64Url),
    deviceId: stored.deviceId,
  };
}

/** Load existing device identity or generate a new one. */
export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  if (existsSync(KEYS_FILE)) {
    try {
      return loadKeyPair();
    } catch {
      console.error("[occ] failed to load device keys, generating new ones");
    }
  }

  return generateKeyPair();
}

/**
 * Build the v3 payload string and sign it with the device's private key.
 *
 * Payload format: `v3|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce|platform|deviceFamily`
 */
export async function signChallenge(
  identity: DeviceIdentity,
  nonce: string,
  token: string,
): Promise<{ signature: string; signedAt: number }> {
  const signedAt = Date.now();
  const scopes = "operator.read,operator.write";
  const platform = process.platform === "darwin" ? "macos" : process.platform;

  const payload = [
    "v3",
    identity.deviceId,
    "occ",
    "backend",
    "operator",
    scopes,
    String(signedAt),
    token,
    nonce,
    platform,
    "",
  ].join("|");

  const keyData = identity.privateKeyRaw.buffer as ArrayBuffer;
  const privateKey = await crypto.subtle.importKey("pkcs8", keyData, "Ed25519", false, ["sign"]);

  const payloadBytes = new TextEncoder().encode(payload) as Uint8Array<ArrayBuffer>;
  const signatureBuffer = await crypto.subtle.sign("Ed25519", privateKey, payloadBytes);
  const signature = base64UrlEncode(signatureBuffer);

  return { signature, signedAt };
}
