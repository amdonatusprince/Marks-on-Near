import { MARKS_CONTRACT, MARKS_RPC } from "../../shared/marks";
import { repoRoot } from "./auth-script";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { access } from "fs/promises";
import os from "os";
import path from "path";

const LEAD_SEC = Number(process.env.MARKS_KEEP_LEAD || 30 * 60);
const FEE = BigInt("20000000000000000000000");
const CUSHION = BigInt("50000000000000000000000");
const AGENT_FLOOR = BigInt("1000000000000000000000000");
const CONTRACT_FLOOR = BigInt("1000000000000000000000000");
const GAS = BigInt("300000000000000");

const state = globalThis as typeof globalThis & { marksKeeper?: boolean };

type Market = { symbol: string; mark_updated_ns: string };
type Share = { asset_id: string; updated_ns: string | number };
type Job = {
  label: string;
  methodName: "refresh_mark" | "refresh_share";
  args: Record<string, string>;
  ageSec: number;
};

/** Start the price keeper inside this server process. A second call does nothing. */
export function startKeeper() {
  if (state.marksKeeper || process.env.MARKS_KEEPER === "off") return;
  state.marksKeeper = true;
  const account =
    process.env.MARKS_KEEPER_ACCOUNT?.trim() || process.env.AGENT_ID?.trim();
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
    const pid = Number(
      readFileSync(path.join(os.tmpdir(), "marks-v2-keep.pid"), "utf8").trim(),
    );
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
      console.error(
        "[marks-keep]",
        caught instanceof Error ? caught.message : caught,
      );
      return 300_000;
    });
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

async function tick(account: string, secret: string) {
  const contract = MARKS_CONTRACT;
  const rows = await prices(contract);
  if (rows.length === 0) return 300_000;
  const due = rows.filter((row) => row.ageSec >= LEAD_SEC);
  if (due.length === 0) {
    const oldest = rows.reduce((age, row) => Math.max(age, row.ageSec), 0);
    const wait = Math.max(60, LEAD_SEC - oldest) * 1000;
    console.log(
      `[marks-keep] prices are ${oldest}s old. Next refresh in ${Math.round(wait / 1000)}s.`,
    );
    return wait;
  }
  const balance = await yocto(account);
  const room = affordable(balance, account === contract);
  if (room < 1) {
    console.error(
      `[marks-keep] ${account} has ${(Number(balance) / 1e24).toFixed(2)} NEAR, which is short of a 0.02 NEAR refresh.`,
    );
    return 30 * 60 * 1000;
  }
  const batch = due.slice(0, room);
  const signer = await nearAccount(account, secret);
  console.log(
    `[marks-keep] refreshing ${batch.length} of ${due.length} stale prices as ${account}`,
  );
  for (const row of batch) {
    try {
      const outcome = await signer.callFunctionRaw({
        contractId: contract,
        methodName: row.methodName,
        args: row.args,
        deposit: FEE,
        gas: GAS,
      });
      console.log(`[marks-keep] ${row.label} ${outcome.transaction.hash}`);
    } catch (caught) {
      console.error(
        `[marks-keep] ${row.label} failed:`,
        caught instanceof Error ? caught.message : caught,
      );
    }
  }
  return due.length > batch.length ? 60_000 : LEAD_SEC * 1000;
}

function affordable(balance: bigint, contractPayer: boolean) {
  const floor = contractPayer ? CONTRACT_FLOOR : AGENT_FLOOR;
  if (balance <= floor + CUSHION) return 0;
  return Number((balance - floor - CUSHION) / FEE);
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
    new JsonRpcProvider({ url: MARKS_RPC }),
    KeyPairSigner.fromSecretKey(key.toString()),
  );
}

async function prices(contract: string) {
  const now = Date.now() * 1_000_000;
  const listed = await view<Market[]>(contract, "get_markets");
  const shares = await view<Share[]>(contract, "get_shares");
  const rows: Job[] = [
    ...listed.map((market) => ({
      label: market.symbol,
      methodName: "refresh_mark" as const,
      args: { symbol: market.symbol },
      ageSec: ageOf(now, market.mark_updated_ns),
    })),
    ...shares.map((share) => ({
      label: share.asset_id,
      methodName: "refresh_share" as const,
      args: { asset_id: share.asset_id },
      ageSec: ageOf(now, share.updated_ns),
    })),
  ];
  return rows.sort((left, right) => right.ageSec - left.ageSec);
}

function ageOf(now: number, stamp: string | number) {
  return Math.max(0, Math.round((now - Number(stamp)) / 1_000_000_000));
}

async function view<T>(account: string, method: string): Promise<T> {
  const result = await rpcQuery({
    request_type: "call_function",
    finality: "final",
    account_id: account,
    method_name: method,
    args_base64: Buffer.from("{}").toString("base64"),
  });
  const bytes = (result as { result?: number[] }).result ?? [];
  return JSON.parse(Buffer.from(bytes).toString()) as T;
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
  const response = await fetch(MARKS_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "marks-keep",
      method: "query",
      params,
    }),
  });
  if (!response.ok) throw new Error(`RPC returned ${response.status}`);
  const body = (await response.json()) as {
    error?: { message?: string };
    result?: unknown;
  };
  if (body.error) throw new Error(body.error.message || "RPC query failed");
  return body.result;
}

async function spawnScript() {
  const script = path.join(repoRoot(), "scripts", "v2-keep.sh");
  try {
    await access(script);
  } catch {
    console.error(
      "[marks-keep] set AGENT_ID and MARKS_KEEPER_KEY on the server. The Mac keychain is not part of the deploy.",
    );
    return;
  }
  const child = spawn("bash", [script, "--loop"], { cwd: repoRoot() });
  child.stdout.on("data", (chunk: Buffer) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  child.on("exit", (code) => console.log(`[marks-keep] script exited ${code}`));
}
