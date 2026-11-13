// Moi's claim-key model on NEAR (Moi is MIT: https://github.com/ramakrishnanhulk20/Moi).
// The secret lives only in the link fragment, which a browser never sends to a server.
import { ed25519 } from "@noble/curves/ed25519";

const NOTE_INFO = new TextEncoder().encode("marks-gift-note");
export const MAX_NOTE_BYTES = 512;

export function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function fromHex(hex: string) {
  if (!/^([0-9a-f]{2})*$/i.test(hex)) throw new Error("This link is damaged");
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

export type ClaimKey = { secret: string; claimKey: string; keyProof: string };

/** A one-time key, the public half, and a proof that the sender holds it. */
export function newClaimKey(contract: string, sender: string): ClaimKey {
  const secret = ed25519.utils.randomPrivateKey();
  const message = new TextEncoder().encode(
    `marks-gift-register:${contract}:${sender}`,
  );
  return {
    secret: toHex(secret),
    claimKey: toHex(ed25519.getPublicKey(secret)),
    keyProof: toHex(ed25519.sign(message, secret)),
  };
}

export function publicKeyOf(secret: string) {
  return toHex(ed25519.getPublicKey(fromHex(secret)));
}

/** The claim signature binds the recipient, so a copied signature pays nobody else. */
export function claimSignature(
  contract: string,
  secret: string,
  giftId: number,
  recipient: string,
) {
  const message = new TextEncoder().encode(
    `marks-gift-claim:${contract}:${giftId}:${recipient}`,
  );
  return toHex(ed25519.sign(message, fromHex(secret)));
}

async function noteKey(secret: string) {
  const base = await crypto.subtle.importKey(
    "raw",
    fromHex(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: NOTE_INFO,
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Seal a note with a key derived from the link secret. Returns hex: 12 bytes of IV then ciphertext. */
export async function sealNote(secret: string, text: string) {
  if (!text.trim()) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await noteKey(secret),
      new TextEncoder().encode(text),
    ),
  );
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  if (out.length > MAX_NOTE_BYTES) throw new Error("The note is too long");
  return toHex(out);
}

export async function openNote(secret: string, hex: string) {
  if (!hex) return "";
  const bytes = fromHex(hex);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) },
    await noteKey(secret),
    bytes.slice(12),
  );
  return new TextDecoder().decode(plain);
}

/** The longest note that still fits: 512 bytes less the IV and the 16-byte tag. */
export const MAX_NOTE_TEXT = MAX_NOTE_BYTES - 12 - 16;

export function giftLink(origin: string, giftId: number, secret: string) {
  return `${origin}/g/${giftId}#${secret}`;
}
