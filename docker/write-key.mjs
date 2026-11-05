import { createRequire } from "node:module";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire("/marks/agent/package.json");
const { KeyPair } = require("@near-js/crypto");

const secret = process.env.MARKS_KEEPER_KEY?.trim() ?? "";
const account = process.env.AGENT_ID?.trim() ?? "";

if (!account) {
  console.error("AGENT_ID is required.");
  process.exit(1);
}
if (!secret.startsWith("ed25519:")) {
  console.error("MARKS_KEEPER_KEY must be an ed25519 secret key.");
  process.exit(1);
}

const key = KeyPair.fromString(secret);
const body = `${JSON.stringify({
  account_id: account,
  public_key: key.getPublicKey().toString(),
  private_key: secret,
})}\n`;

const dir = "/root/.near-credentials/testnet";
await mkdir(dir, { recursive: true });
const file = path.join(dir, `${account}.json`);
await writeFile(file, body, { mode: 0o600 });
await chmod(file, 0o600);
console.log(`near-cli key ready for ${account}`);
