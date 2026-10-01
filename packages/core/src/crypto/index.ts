/**
 * Zero-knowledge WebCrypto engine.
 *
 * Pure WebCrypto API implementation with zero external crypto dependencies.
 * All operations use the native `crypto.subtle` and `crypto.getRandomValues`
 * APIs, so the module runs in Bun, browsers, and modern Node.js.
 */

import type { EncryptedPayload } from './types';

/** PBKDF2 iteration count for master key derivation. */
const PBKDF2_ITERATIONS = 100_000;

/** AES-GCM initialization vector length (bytes). */
const IV_LENGTH_BYTES = 12;

/** AES-GCM authentication tag length (bytes). */
const AUTH_TAG_LENGTH_BYTES = 16;

/** Salt length (bytes) for key derivation. */
const SALT_LENGTH_BYTES = 16;

/**
 * Encode a byte array as a base64 string.
 *
 * Chunked to avoid a stack overflow from spreading very large arrays into
 * `String.fromCharCode`.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Decode a base64 string into a byte array.
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derive an AES-GCM-256 master key from a user's password and salt.
 *
 * Uses PBKDF2 with SHA-256 and 100,000 iterations. The resulting key is a
 * zero-knowledge key: it is derived locally and never leaves the client.
 *
 * @param password - The user's password.
 * @param salt - A base64-encoded salt (see {@link generateSalt}).
 * @returns An AES-GCM-256 `CryptoKey` usable for encrypt/decrypt.
 */
export async function deriveMasterKey(
  password: string,
  salt: string,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Generate a cryptographically secure random salt.
 *
 * @returns A base64-encoded string of 16 random bytes.
 */
export function generateSalt(): string {
  const salt = new Uint8Array(SALT_LENGTH_BYTES);
  crypto.getRandomValues(salt);
  return bytesToBase64(salt);
}

/**
 * Encrypt a plaintext string with AES-GCM-256.
 *
 * WebCrypto appends the 16-byte authentication tag to the ciphertext; this
 * function extracts it and returns it separately for explicit verification on
 * decryption.
 *
 * @param plaintext - The string to encrypt.
 * @param key - An AES-GCM-256 `CryptoKey` (see {@link deriveMasterKey}).
 * @returns The base64-encoded ciphertext, IV, and auth tag.
 */
export async function encryptPayload(
  plaintext: string,
  key: CryptoKey,
): Promise<EncryptedPayload> {
  const iv = new Uint8Array(IV_LENGTH_BYTES);
  crypto.getRandomValues(iv);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );

  const raw = new Uint8Array(encrypted);
  const body = raw.subarray(0, raw.length - AUTH_TAG_LENGTH_BYTES);
  const authTag = raw.subarray(raw.length - AUTH_TAG_LENGTH_BYTES);

  return {
    ciphertext: bytesToBase64(body),
    iv: bytesToBase64(iv),
    authTag: bytesToBase64(authTag),
  };
}

/**
 * Decrypt an AES-GCM-256 payload and return the original plaintext.
 *
 * The authentication tag is re-appended to the ciphertext before decryption,
 * which causes WebCrypto to verify integrity. If the tag does not match (data
 * was tampered with, or the key is wrong), this rejects.
 *
 * @param ciphertext - Base64-encoded ciphertext (body only, no tag).
 * @param iv - Base64-encoded 12-byte initialization vector.
 * @param authTag - Base64-encoded 16-byte authentication tag.
 * @param key - The AES-GCM-256 `CryptoKey` used to encrypt.
 * @returns The decrypted plaintext string.
 */
export async function decryptPayload(
  ciphertext: string,
  iv: string,
  authTag: string,
  key: CryptoKey,
): Promise<string> {
  const body = base64ToBytes(ciphertext);
  const tag = base64ToBytes(authTag);
  const ivBytes = base64ToBytes(iv);

  const combined = new Uint8Array(body.length + tag.length);
  combined.set(body, 0);
  combined.set(tag, body.length);

  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes.buffer as ArrayBuffer,
    },
    key,
    combined.buffer as ArrayBuffer,
  );

  return new TextDecoder().decode(plaintext);
}
