import { PublicKey } from "@near-js/crypto";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { MARKS_RPC } from "../../shared/marks";
import { repoRoot } from "./auth-script";

const RECIPIENT = "Marks";
const PREFIX = 2147484061;
const DAY_MS = 24 * 60 * 60 * 1000;

type Store = {
  nonces: Record<string, number>;
  links: Record<string, Record<string, string>>;
};

const empty = (): Store => ({ nonces: {}, links: {} });

function file() {
  return path.join(repoRoot(), "agent", "data", "gift-links.json");
}

async function read(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(file(), "utf8")) as Partial<Store>;
    return { nonces: parsed.nonces ?? {}, links: parsed.links ?? {} };
  } catch {
    return empty();
  }
}

async function write(store: Store) {
  const target = file();
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(store), { mode: 0o600 });
}

function u32(value: number) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function text(value: string) {
  const bytes = new TextEncoder().encode(value);
  return concat(u32(bytes.length), bytes);
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function bytesFrom(value: string) {
  const raw = Buffer.from(value, "base64");
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
}

function digest(links: Record<string, string>) {
  return Object.keys(links)
    .sort()
    .map((id) => `${id} ${links[id]}`)
    .join("\n");
}

function verify(opts: {
  message: string;
  nonce: string;
  publicKey: string;
  signature: string;
}) {
  const nonce = bytesFrom(opts.nonce);
  const signature = bytesFrom(opts.signature);
  if (nonce.length !== 32 || signature.length !== 64) return false;
  const payload = concat(
    u32(PREFIX),
    text(opts.message),
    nonce,
    text(RECIPIENT),
    new Uint8Array([0]),
  );
  const hash = createHash("sha256").update(payload).digest();
  return PublicKey.from(opts.publicKey).verify(hash, signature);
}

async function keyBelongs(accountId: string, publicKey: string) {
  const response = await fetch(MARKS_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "marks",
      method: "query",
      params: {
        request_type: "view_access_key",
        finality: "optimistic",
        account_id: accountId,
        public_key: publicKey,
      },
    }),
  });
  const body = (await response.json()) as { result?: { nonce?: unknown } };
  return body.result?.nonce !== undefined;
}

function freshNonce(store: Store, nonce: string) {
  const now = Date.now();
  for (const [saved, at] of Object.entries(store.nonces)) {
    if (now - at > DAY_MS) delete store.nonces[saved];
  }
  if (store.nonces[nonce]) return false;
  store.nonces[nonce] = now;
  return true;
}

function linksLookRight(links: Record<string, string>) {
  return Object.entries(links).every(
    ([id, link]) =>
      /^[0-9]+$/.test(id) &&
      link.includes(`/g/${id}#`) &&
      /#[0-9a-f]{64}$/i.test(link),
  );
}

export async function storeGiftLinks(opts: {
  accountId: string;
  publicKey: string;
  signature: string;
  nonce: string;
  links: Record<string, string>;
}) {
  const body = digest(opts.links);
  const message = `Store Marks gift links\n${opts.accountId}\n${body}`;
  if (!body || !linksLookRight(opts.links)) {
    throw new Error("Those gift links are not claim links");
  }
  if (!verify({ ...opts, message }))
    throw new Error("The wallet signature does not match");
  if (!(await keyBelongs(opts.accountId, opts.publicKey))) {
    throw new Error("That key is not on the account");
  }
  const store = await read();
  if (!freshNonce(store, opts.nonce))
    throw new Error("That signature was already used");
  store.links[opts.accountId] = {
    ...(store.links[opts.accountId] ?? {}),
    ...opts.links,
  };
  await write(store);
}

export async function readGiftLinks(opts: {
  accountId: string;
  publicKey: string;
  signature: string;
  nonce: string;
}) {
  const message = `Read Marks gift links\n${opts.accountId}`;
  if (!verify({ ...opts, message }))
    throw new Error("The wallet signature does not match");
  if (!(await keyBelongs(opts.accountId, opts.publicKey))) {
    throw new Error("That key is not on the account");
  }
  const store = await read();
  if (!freshNonce(store, opts.nonce))
    throw new Error("That signature was already used");
  await write(store);
  return store.links[opts.accountId] ?? {};
}
