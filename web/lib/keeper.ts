import { repoRoot } from "@/lib/auth-script";
import { rpcUrl } from "@/lib/network";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { access } from "fs/promises";
import os from "os";
import path from "path";

const LEAD_SEC = 45 * 60;
const FEE = BigInt("20000000000000000000000");
const CUSHION = BigInt("50000000000000000000000");
const AGENT_FLOOR = BigInt("2000000000000000000000000");
const CONTRACT_FLOOR = BigInt("1000000000000000000000000");
const GAS = BigInt("300000000000000");

const state = globalThis as typeof globalThis & { marksKeeper?: boolean };

type Market = { symbol: string; mark_updated_ns: string };

/** Start the price keeper inside this server process. A second call does nothing. */
export function startKeeper() {
  if (state.marksKeeper || process.env.MARKS_KEEPER === "off") return;
  state.marksKeeper = true;
  const account = process.env.MARKS_KEEPER_ACCOUNT?.trim();
  const secret = process.env.MARKS_KEEPER_KEY?.trim();
  if (account && secret) {
    if (shellKeeperRunning()) {
      console.log("[marks-keep] the shell keeper is already running");
      return;
    }
    console.log(`[marks-keep] signing as ${account}`);
    void loop(account, secret);
    return;
  }
  void spawnScript();
}

function shellKeeperRunning() {
  try {
    const pid = Number(readFileSync(path.join(os.tmpdir(), "marks-v2-keep.pid"), "utf8").trim());
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function loop(account: string, secret: string) {
  for (;;) {
    const wait = await tick(account, secret).catch((caught) => {
      console.error("[marks-keep]", caught instanceof Error ? caught.message : caught);
      return 300_000;
    });
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

async function tick(account: string, secret: string) {
  const contract = process.env.NEXT_PUBLIC_CONTRACT_ID?.trim();
  if (!contract) throw new Error("NEXT_PUBLIC_CONTRACT_ID is not set");
  const rows = await markets(contract);
  const oldest = rows.reduce((age, row) => Math.max(age, row.ageSec), 0);
  if (rows.length === 0) return 300_000;
  if (oldest < LEAD_SEC) {
    const wait = (LEAD_SEC - oldest) * 1000;
    console.log(
      `[marks-keep] marks are ${oldest}s old. Next refresh in ${Math.round(wait / 1000)}s.`,
    );
    return wait;
  }
  const balance = await yocto(account);
  const cost = FEE * BigInt(rows.length) + CUSHION;
  const floor = account === contract ? CONTRACT_FLOOR : AGENT_FLOOR;
  if (balance - cost < floor) {
    console.error(
      `[marks-keep] ${account} has ${(Number(balance) / 1e24).toFixed(2)} NEAR, which is short of this pass.`,
    );
    return 30 * 60 * 1000;
  }
  const signer = await nearAccount(account, secret);
  console.log(`[marks-keep] refreshing ${rows.length} markets as ${account}`);
  for (const row of rows) {
    try {
      const outcome = await signer.functionCall({
        contractId: contract,
        methodName: "refresh_mark",
        args: { symbol: row.symbol },
        attachedDeposit: FEE,
        gas: GAS,
      });
      console.log(`[marks-keep] ${row.symbol} ${outcome.transaction.hash}`);
    } catch (caught) {
      console.error(
        `[marks-keep] ${row.symbol} failed:`,
        caught instanceof Error ? caught.message : caught,
      );
    }
  }
  return 60_000;
}

async function nearAccount(account: string, secret: string) {
  const trimmed = secret.trim();
  if (!trimmed.startsWith("ed25519:")) {
    throw new Error("MARKS_KEEPER_KEY must be an ed25519 secret key");
  }
  const { Account } = await import("@near-js/accounts");
  const { KeyPair } = await import("@near-js/crypto");
  const { JsonRpcProvider } = await import("@near-js/providers");
  const { KeyPairSigner } = await import("@near-js/signers");
  const key = KeyPair.fromString(trimmed as `ed25519:${string}`);
  return new Account(
    account,
    new JsonRpcProvider({ url: rpcUrl("testnet") }),
    KeyPairSigner.fromSecretKey(key.toString()),
  );
}

async function markets(contract: string) {
  const result = await rpcQuery({
    request_type: "call_function",
    finality: "final",
    account_id: contract,
    method_name: "get_markets",
    args_base64: Buffer.from("{}").toString("base64"),
  });
  const bytes = (result as { result?: number[] }).result ?? [];
  const listed = JSON.parse(Buffer.from(bytes).toString()) as Market[];
  const now = Date.now() * 1_000_000;
  return listed.map((market) => ({
    symbol: market.symbol,
    ageSec: Math.max(0, Math.round((now - Number(market.mark_updated_ns)) / 1_000_000_000)),
  }));
}

async function yocto(account: string) {
  const result = (await rpcQuery({
    request_type: "view_account",
    finality: "final",
    account_id: account,
  })) as { amount?: string };
  return BigInt(result.amount ?? "0");
}

async function rpcQuery(params: object) {
  const response = await fetch(rpcUrl("testnet"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "marks-keep", method: "query", params }),
  });
  if (!response.ok) throw new Error(`RPC returned ${response.status}`);
  const body = (await response.json()) as { error?: { message?: string }; result?: unknown };
  if (body.error) throw new Error(body.error.message || "RPC query failed");
  return body.result;
}

async function spawnScript() {
  const script = path.join(repoRoot(), "scripts", "v2-keep.sh");
  try {
    await access(script);
  } catch {
    console.error(
      "[marks-keep] set MARKS_KEEPER_ACCOUNT and MARKS_KEEPER_KEY on the server. The Mac keychain is not part of the deploy.",
    );
    return;
  }
  const child = spawn("bash", [script, "--loop"], { cwd: repoRoot() });
  child.stdout.on("data", (chunk: Buffer) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  child.on("exit", (code) => console.log(`[marks-keep] script exited ${code}`));
}
