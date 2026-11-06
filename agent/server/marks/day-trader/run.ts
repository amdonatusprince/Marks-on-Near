import { spawn } from "child_process";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { repoRoot } from "../auth-script";
import { MARKS_TOKEN, money, viewChain } from "../../../shared/marks";
import { shareTicker, units } from "../../../app/marks/lib/v2";

const PACK = path.dirname(fileURLToPath(import.meta.url));

type DeskName = {
  yahoo: string;
  share?: string;
  market?: string;
  name: string;
};

const DESK: Record<string, DeskName> = {
  AAPL: { yahoo: "AAPL", share: "aapl", market: "AAPL-PERP", name: "Apple" },
  AMZN: { yahoo: "AMZN", share: "amzn", market: "AMZN-PERP", name: "Amazon" },
  MSFT: {
    yahoo: "MSFT",
    share: "msft",
    market: "MSFT-PERP",
    name: "Microsoft",
  },
  NVDA: { yahoo: "NVDA", share: "nvda", market: "NVDA-PERP", name: "Nvidia" },
  TSLA: { yahoo: "TSLA", share: "tsla", market: "TSLA-PERP", name: "Tesla" },
  XAU: { yahoo: "GC=F", share: "xau", market: "GOLD-PERP", name: "Gold" },
  GOLD: { yahoo: "GC=F", share: "xau", market: "GOLD-PERP", name: "Gold" },
  "GC=F": { yahoo: "GC=F", share: "xau", market: "GOLD-PERP", name: "Gold" },
  OIL: { yahoo: "CL=F", share: "oil", market: "OIL-PERP", name: "Oil" },
  "CL=F": { yahoo: "CL=F", share: "oil", market: "OIL-PERP", name: "Oil" },
  BTC: { yahoo: "BTC-USD", market: "BTC-PERP", name: "Bitcoin" },
  "BTC-USD": { yahoo: "BTC-USD", market: "BTC-PERP", name: "Bitcoin" },
  ETH: { yahoo: "ETH-USD", market: "ETH-PERP", name: "Ether" },
  "ETH-USD": { yahoo: "ETH-USD", market: "ETH-PERP", name: "Ether" },
  BNB: { yahoo: "BNB-USD", market: "BNB-PERP", name: "BNB" },
  "BNB-USD": { yahoo: "BNB-USD", market: "BNB-PERP", name: "BNB" },
  SOL: { yahoo: "SOL-USD", market: "SOL-PERP", name: "Solana" },
  "SOL-USD": { yahoo: "SOL-USD", market: "SOL-PERP", name: "Solana" },
  NEAR: { yahoo: "NEAR-USD", market: "NEAR-PERP", name: "NEAR" },
  "NEAR-USD": { yahoo: "NEAR-USD", market: "NEAR-PERP", name: "NEAR" },
};

const MARKS_SYMBOLS = [
  "AAPL",
  "AMZN",
  "MSFT",
  "NVDA",
  "TSLA",
  "GC=F",
  "CL=F",
  "BTC-USD",
  "ETH-USD",
  "BNB-USD",
  "SOL-USD",
  "NEAR-USD",
];

export function resolveDesk(raw: string): DeskName {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  const share = trimmed.toLowerCase();
  const direct = DESK[upper];
  if (direct) return direct;
  if (upper.endsWith("-PERP")) {
    const base = upper.slice(0, -5);
    const named =
      DESK[base] ||
      (base === "GOLD" ? DESK.XAU : base === "OIL" ? DESK.OIL : undefined);
    if (named) return named;
  }
  const byShare = Object.values(DESK).find((row) => row.share === share);
  if (byShare) return byShare;
  return { yahoo: upper || "UNKNOWN", name: upper || "UNKNOWN" };
}

function dataRoot() {
  return path.join(repoRoot(), "agent", "data");
}

async function seedWorkspace() {
  const traderDir = path.join(dataRoot(), "trader");
  await mkdir(path.join(traderDir, "state"), { recursive: true });
  const configPath = path.join(traderDir, "config.json");
  const universePath = path.join(traderDir, "universe.txt");
  try {
    await readFile(configPath);
  } catch {
    await writeFile(
      configPath,
      await readFile(path.join(PACK, "marks-config.json")),
    );
  }
  try {
    await readFile(universePath);
  } catch {
    await writeFile(
      universePath,
      await readFile(path.join(PACK, "marks-universe.txt")),
    );
  }
}

export async function writeMarksPortfolio(accountId: string) {
  const [wallet, holdings, first] = await Promise.all([
    viewChain<string>(
      "ft_balance_of",
      { account_id: accountId },
      MARKS_TOKEN,
    ).catch(() => "0"),
    viewChain<[string, string][]>("get_holdings", {
      account_id: accountId,
    }).catch(() => [] as [string, string][]),
    viewChain<{ unallocated?: string }>("get_trader", {
      symbol: "NEAR-PERP",
      account_id: accountId,
    }).catch(() => ({ unallocated: "0" })),
  ]);
  const cash = Number(first.unallocated || "0") / 1e6;
  const positions = holdings
    .filter(([, raw]) => BigInt(raw) > BigInt(0))
    .map(([asset, raw]) => ({
      ticker: shareTicker(asset),
      shares: Number(units(raw, 6)),
    }));
  await seedWorkspace();
  await writeFile(
    path.join(dataRoot(), "trader", "portfolio.json"),
    JSON.stringify(
      {
        cash,
        walletMusdc: money(wallet),
        positions,
        accountId,
      },
      null,
      2,
    ),
  );
  return { cash, positions };
}

function parseJson(text: string) {
  const start = text.indexOf("{");
  const array = text.indexOf("[");
  const at =
    start >= 0 && (array < 0 || start < array)
      ? start
      : array >= 0
        ? array
        : -1;
  if (at < 0) return null;
  try {
    return JSON.parse(text.slice(at));
  } catch {
    return null;
  }
}

export async function runTool(
  script: string,
  args: string[],
  timeoutMs = 90_000,
) {
  await seedWorkspace();
  const file = path.join(PACK, script);
  return new Promise<{
    ok: boolean;
    code: number;
    stdout: string;
    stderr: string;
    data: unknown;
  }>((resolve, reject) => {
    const child = spawn("python3", [file, ...args], {
      cwd: dataRoot(),
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${script} ran longer than ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        data: parseJson(stdout),
      });
    });
  });
}

export type DeskFact = {
  yahoo: string;
  name: string;
  share: string | null;
  market: string | null;
  listed: boolean;
};

export function deskFacts(raw: string): DeskFact {
  const desk = resolveDesk(raw);
  return {
    yahoo: desk.yahoo,
    name: desk.name,
    share: desk.share ?? null,
    market: desk.market ?? null,
    listed: Boolean(desk.share || desk.market),
  };
}

export function marksSymbols(list?: string) {
  if (!list?.trim()) return MARKS_SYMBOLS.join(",");
  return list
    .split(",")
    .map((item) => resolveDesk(item).yahoo)
    .join(",");
}

export function marksTicket(order: {
  symbol?: string;
  side?: string;
  qty?: string;
  plan?: { entry?: number };
}) {
  const desk = resolveDesk(order.symbol || "");
  const qty = Number(order.qty || 0);
  const entry = Number(order.plan?.entry || 0);
  const dollars = qty && entry ? (qty * entry).toFixed(2) : undefined;
  const buy = (order.side || "buy") === "buy";
  return {
    yahoo: desk.yahoo,
    share: desk.share
      ? {
          tool: "trade-shares",
          args: {
            side: buy ? "buy" : "sell",
            assetId: desk.share,
            amount: buy ? dollars : String(qty),
          },
        }
      : null,
    market: desk.market
      ? {
          tool: "plan-order",
          args: {
            symbol: desk.market,
            side: buy ? "long" : "short",
            amount: dollars,
          },
        }
      : null,
  };
}

export { MARKS_SYMBOLS };
