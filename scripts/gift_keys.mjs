#!/usr/bin/env node
// One-time gift claim keys, the same scheme the app uses.
//   node scripts/gift_keys.mjs new <contract> <sender>
//     prints {"secret","claim_key","key_proof"} as JSON
//   node scripts/gift_keys.mjs claim <contract> <secret> <gift_id> <recipient>
//     prints the claim signature as hex

import { createPrivateKey, createPublicKey, randomBytes, sign } from "node:crypto";

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function keyFromSeed(seed) {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

function publicHex(privateKey) {
  const der = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32).toString("hex");
}

function signHex(privateKey, message) {
  return sign(null, Buffer.from(message), privateKey).toString("hex");
}

const [command, contract, ...rest] = process.argv.slice(2);

if (command === "new" && contract && rest.length === 1) {
  const seed = randomBytes(32);
  const key = keyFromSeed(seed);
  console.log(
    JSON.stringify({
      secret: seed.toString("hex"),
      claim_key: publicHex(key),
      key_proof: signHex(key, `marks-gift-register:${contract}:${rest[0]}`),
    }),
  );
} else if (command === "claim" && contract && rest.length === 3) {
  const [secret, giftId, recipient] = rest;
  const key = keyFromSeed(Buffer.from(secret, "hex"));
  console.log(signHex(key, `marks-gift-claim:${contract}:${giftId}:${recipient}`));
} else {
  console.error(
    "Usage: gift_keys.mjs new <contract> <sender> | claim <contract> <secret> <gift_id> <recipient>",
  );
  process.exit(1);
}
