import { describe, expect, it } from "bun:test";

import { getDeviceIdentity, signChallenge } from "../src/device-identity.js";

describe("device identity", () => {
  it("generates a valid device identity", async () => {
    const identity = await getDeviceIdentity();

    expect(identity.publicKeyBase64Url).toBeTruthy();
    expect(identity.deviceId).toMatch(/^[\da-f]{64}$/u);
    expect(identity.privateKeyRaw.length).toBeGreaterThan(0);
  });

  it("returns consistent identity on subsequent calls", async () => {
    const first = await getDeviceIdentity();
    const second = await getDeviceIdentity();

    expect(first.deviceId).toBe(second.deviceId);
    expect(first.publicKeyBase64Url).toBe(second.publicKeyBase64Url);
  });

  it("signs a challenge nonce and produces a non-empty signature", async () => {
    const identity = await getDeviceIdentity();
    const nonce = "test-nonce-12345";
    const token = "test-token";

    const { signature, signedAt } = await signChallenge(identity, nonce, token);

    expect(signature).toBeTruthy();
    expect(signature.length).toBeGreaterThan(0);
    expect(signedAt).toBeGreaterThan(0);
    expect(signedAt).toBeLessThanOrEqual(Date.now());
  });

  it("produces different signatures for different nonces", async () => {
    const identity = await getDeviceIdentity();
    const token = "test-token";

    const first = await signChallenge(identity, "nonce-a", token);
    const second = await signChallenge(identity, "nonce-b", token);

    expect(first.signature).not.toBe(second.signature);
  });
});
