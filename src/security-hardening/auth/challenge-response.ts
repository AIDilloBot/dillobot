/**
 * DilloBot Challenge-Response Authentication
 *
 * Provides mandatory challenge-response authentication for all connections,
 * including local/loopback connections.
 */

import crypto from "node:crypto";
import type { AuthResult, ChallengePayload, ChallengeResponse } from "../types.js";

/**
 * Challenge validity window in milliseconds.
 * Challenges older than this are rejected.
 */
const CHALLENGE_VALIDITY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Clock skew tolerance in milliseconds.
 */
const CLOCK_SKEW_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Generate a challenge for a connecting device.
 *
 * This challenge must be signed by the device's private key
 * to prove device identity.
 *
 * @param serverIdentity Server's public key fingerprint
 * @returns Challenge payload
 */
export function generateChallenge(serverIdentity: string): ChallengePayload {
  const nonce = crypto.randomBytes(32).toString("base64url");
  const timestamp = Date.now();

  return {
    nonce,
    timestamp,
    serverIdentity,
  };
}

/**
 * Build the challenge message that needs to be signed.
 *
 * @param challenge The challenge payload
 * @returns Message to sign
 */
export function buildChallengeMessage(challenge: ChallengePayload): string {
  return [
    "v2", // Version marker
    challenge.nonce,
    String(challenge.timestamp),
    challenge.serverIdentity,
  ].join("|");
}

/**
 * Verify a challenge response from a device.
 *
 * @param response The device's response to the challenge
 * @param expectedChallenge The original challenge that was sent
 * @returns Authentication result
 */
export function verifyChallenge(response: ChallengeResponse, expectedChallenge: ChallengePayload): AuthResult {
  // Verify challenge matches
  if (response.challenge.nonce !== expectedChallenge.nonce) {
    return {
      ok: false,
      reason: "nonce_mismatch",
    };
  }

  // Verify timestamp is within validity window
  const now = Date.now();
  const challengeAge = now - response.challenge.timestamp;

  if (challengeAge > CHALLENGE_VALIDITY_MS) {
    return {
      ok: false,
      reason: "challenge_expired",
    };
  }

  if (challengeAge < -CLOCK_SKEW_MS) {
    return {
      ok: false,
      reason: "challenge_from_future",
    };
  }

  // Verify server identity matches
  if (response.challenge.serverIdentity !== expectedChallenge.serverIdentity) {
    return {
      ok: false,
      reason: "server_identity_mismatch",
    };
  }

  // Verify device signature
  try {
    const message = buildChallengeMessage(response.challenge);
    const publicKey = importPublicKey(response.devicePublicKey);
    const signature = Buffer.from(response.deviceSignature, "base64url");

    const isValid = crypto.verify(null, Buffer.from(message), publicKey, signature);

    if (!isValid) {
      return {
        ok: false,
        reason: "invalid_signature",
      };
    }

    // Derive device ID from public key
    const deviceId = deriveDeviceId(response.devicePublicKey);

    return {
      ok: true,
      deviceId,
    };
  } catch (error) {
    return {
      ok: false,
      reason: `verification_error: ${(error as Error).message}`,
    };
  }
}

/**
 * Import a public key from base64url-encoded format.
 */
function importPublicKey(publicKeyBase64: string): crypto.KeyObject {
  const publicKeyDer = Buffer.from(publicKeyBase64, "base64url");

  // Try to import as raw Ed25519 key first
  try {
    return crypto.createPublicKey({
      key: publicKeyDer,
      format: "der",
      type: "spki",
    });
  } catch {
    // Try as PEM
    const pem = `-----BEGIN PUBLIC KEY-----\n${publicKeyDer.toString("base64")}\n-----END PUBLIC KEY-----`;
    return crypto.createPublicKey(pem);
  }
}

/**
 * Derive device ID from public key (SHA256 fingerprint).
 */
function deriveDeviceId(publicKeyBase64: string): string {
  const publicKeyDer = Buffer.from(publicKeyBase64, "base64url");
  return crypto.createHash("sha256").update(publicKeyDer).digest("hex");
}

/**
 * Sign a challenge with a device's private key.
 *
 * This is used by the client side to respond to challenges.
 *
 * @param challenge The challenge to sign
 * @param privateKey The device's private key (PEM format)
 * @returns Signature as base64url string
 */
export function signChallenge(challenge: ChallengePayload, privateKey: string): string {
  const message = buildChallengeMessage(challenge);
  const keyObject = crypto.createPrivateKey(privateKey);
  const signature = crypto.sign(null, Buffer.from(message), keyObject);
  return signature.toString("base64url");
}

/**
 * Check if a challenge is still valid (not expired).
 *
 * @param challenge The challenge to check
 * @returns true if the challenge is still valid
 */
export function isChallengeValid(challenge: ChallengePayload): boolean {
  const now = Date.now();
  const challengeAge = now - challenge.timestamp;
  return challengeAge >= -CLOCK_SKEW_MS && challengeAge <= CHALLENGE_VALIDITY_MS;
}

/**
 * Create a challenge-response pair for testing.
 */
export function createTestChallengeResponse(): {
  challenge: ChallengePayload;
  response: ChallengeResponse;
  deviceId: string;
} {
  // Generate test key pair
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");

  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  const publicKeyBase64 = Buffer.from(publicKeyDer).toString("base64url");
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }) as string;

  // Generate challenge
  const challenge = generateChallenge("test-server");

  // Sign challenge
  const signature = signChallenge(challenge, privateKeyPem);

  // Derive device ID
  const deviceId = deriveDeviceId(publicKeyBase64);

  return {
    challenge,
    response: {
      challenge,
      deviceSignature: signature,
      devicePublicKey: publicKeyBase64,
    },
    deviceId,
  };
}
