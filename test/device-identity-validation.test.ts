import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { getDeviceIdentity } from "../src/device-identity.js";

const KEYS_DIR = path.join(homedir(), ".config", "occ");
const KEYS_FILE = path.join(KEYS_DIR, "device-keys.json");
const BACKUP_FILE = path.join(KEYS_DIR, "device-keys.json.bak");

describe("device identity validation", () => {
  let hadExistingKeys = false;

  beforeEach(() => {
    hadExistingKeys = existsSync(KEYS_FILE);

    if (hadExistingKeys) {
      renameSync(KEYS_FILE, BACKUP_FILE);
    }
  });

  afterEach(() => {
    if (hadExistingKeys && existsSync(BACKUP_FILE)) {
      if (existsSync(KEYS_FILE)) {
        unlinkSync(KEYS_FILE);
      }

      renameSync(BACKUP_FILE, KEYS_FILE);
    }
  });

  it("regenerates keys when file contains empty object", async () => {
    mkdirSync(KEYS_DIR, { recursive: true });
    writeFileSync(KEYS_FILE, "{}", { mode: 0o600 });

    const identity = await getDeviceIdentity();

    expect(identity.deviceId).toMatch(/^[\da-f]{64}$/u);
    expect(identity.publicKeyBase64Url).toBeTruthy();
  });

  it("regenerates keys when file contains invalid types", async () => {
    mkdirSync(KEYS_DIR, { recursive: true });
    writeFileSync(KEYS_FILE, '{"deviceId": 123}', { mode: 0o600 });

    const identity = await getDeviceIdentity();

    expect(identity.deviceId).toMatch(/^[\da-f]{64}$/u);
  });

  it("regenerates keys when file contains malformed JSON", async () => {
    mkdirSync(KEYS_DIR, { recursive: true });
    writeFileSync(KEYS_FILE, "not json at all", { mode: 0o600 });

    const identity = await getDeviceIdentity();

    expect(identity.deviceId).toMatch(/^[\da-f]{64}$/u);
  });
});
