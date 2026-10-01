/**
 * Shared types for the zero-knowledge WebCrypto engine.
 */

/**
 * The result of encrypting a payload with AES-GCM-256.
 *
 * All fields are base64-encoded strings so they can be safely stored in JSON,
 * persisted to disk, or transmitted over the wire.
 */
export interface EncryptedPayload {
  /** Base64-encoded ciphertext (the encrypted body, excluding the auth tag). */
  ciphertext: string;
  /** Base64-encoded 12-byte initialization vector. */
  iv: string;
  /** Base64-encoded 16-byte authentication tag. */
  authTag: string;
}
