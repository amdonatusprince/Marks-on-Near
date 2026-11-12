import { grouped } from "@/marks/lib/format";
import {
  contractFor,
  rpcUrl,
  tokenFor,
  type Network,
} from "@/marks/lib/network";

/** Shares carry six decimals: 1_000_000 units are one share. */
export const UNIT = BigInt(1_000_000);
export const FEE_BPS = BigInt(100);
export const SHARE_LTV_BPS = BigInt(5_000);
export const SHARE_LIQUIDATION_BPS = BigInt(6_500);

export type Share = {
  asset_id: string;
  name: string;
  price: string;
  updated_ns: number;
  stale_after_ns: number;
  supply: string;
  pending: string;
};

export type Series = {
  id: string;
  asset_id: string;
  strike: string;
  cap: string;
  expiry_ns: string;
  settle_price: string | null;
  open_interest: number;
  volume: string;
  last_premium: string;
  best_bid: string | null;
  best_ask: string | null;
};

export type OptionLevel = { premium: string; lots: number };
export type OptionBook = { bids: OptionLevel[]; asks: OptionLevel[] };
export type OptionPosition = { long: number; short: number };
export type ShareLoan = { units: string; debt: string };
export type Pool = {
  cash: string;
  lent: string;
  fees: string;
  bad_debt: string;
};

export type GiftAsset =
  | { kind: "usdc"; amount: string }
  | { kind: "shares"; asset_id: string; units: string }
  | { kind: "position"; symbol: string };

export type GiftStatus = "open" | "claimed" | "refunded" | "voided";

export type Gift = {
  id: number;
  sender: string;
  claim_key: string;
  asset: GiftAsset;
  fee: string;
  created_ns: number;
  expiry_ns: number;
  note: string;
  status: GiftStatus;
  recipient: string | null;
  closed_ns: number;
};

/** What one share unit of each asset is, matching the contract sizes in the feed. */
const SHARE_SIZE: Record<string, string> = {
  xau: "0.1 oz of gold",
  oil: "1 barrel of oil",
};

export function shareSize(assetId: string) {
  return SHARE_SIZE[assetId] ?? "1 share";
}

export function shareTicker(assetId: string) {
  return assetId === "xau" ? "GOLD" : assetId.toUpperCase();
}

export function units(raw: string | bigint, digits = 4) {
  const value = typeof raw === "string" ? BigInt(raw) : raw;
  const whole = value / UNIT;
  const frac = (value % UNIT)
    .toString()
    .padStart(6, "0")
    .slice(0, digits)
    .replace(/0+$/, "");
  return frac ? `${grouped(whole)}.${frac}` : grouped(whole);
}

export function unitsFromText(text: string): bigint | null {
  const trimmed = text.trim().replace(/[,\s]/g, "");
  if (!/^\d+(\.\d*)?$/.test(trimmed)) return null;
  const [whole = "0", frac = ""] = trimmed.split(".");
  return BigInt(whole) * UNIT + BigInt(`${frac}000000`.slice(0, 6));
}

export function valueOf(unitCount: bigint, price: bigint) {
  return (unitCount * price) / UNIT;
}

/** One percent, rounded up, as the contract charges it. */
export function fee(amount: bigint) {
  return (amount * FEE_BPS + BigInt(9_999)) / BigInt(10_000);
}

export function isFresh(
  share: Pick<Share, "updated_ns" | "stale_after_ns">,
  nowMs = Date.now(),
) {
  if (!share.updated_ns) return false;
  const age = BigInt(nowMs) * BigInt(1_000_000) - BigInt(share.updated_ns);
  return age <= BigInt(share.stale_after_ns);
}

export function expiryDate(ns: string | number) {
  return new Date(Number(BigInt(ns) / BigInt(1_000_000)));
}

export function shortDate(ns: string | number) {
  return expiryDate(ns).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function seriesTitle(series: Series) {
  return `${shareTicker(series.asset_id)} ${shortDate(series.expiry_ns)} call ${dollarsShort(series.strike)} to ${dollarsShort(series.cap)}`;
}

export function dollarsShort(atoms: string | bigint) {
  const value = typeof atoms === "string" ? BigInt(atoms) : atoms;
  const cents = value / BigInt(10_000);
  const whole = cents / BigInt(100);
  const frac = (cents % BigInt(100)).toString().padStart(2, "0");
  return frac === "00" ? `$${grouped(whole)}` : `$${grouped(whole)}.${frac}`;
}

async function query<T>(
  network: Network,
  account: string,
  method: string,
  args: object,
) {
  if (!account) throw new Error("The v2 contract is not configured");
  const response = await fetch(rpcUrl(network), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "marks",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "optimistic",
        account_id: account,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`RPC returned ${response.status}`);
  const body = (await response.json()) as {
    error?: { message?: string };
    result?: { result?: number[]; error?: string };
  };
  if (body.error) throw new Error(body.error.message ?? "RPC error");
  if (body.result?.error) throw new Error(body.result.error);
  const bytes = body.result?.result;
  if (!bytes) throw new Error("RPC returned no result");
  return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as T;
}

export function viewMarks<T>(
  network: Network,
  method: string,
  args: object = {},
) {
  return query<T>(network, contractFor(network), method, args);
}

export function viewToken<T>(
  network: Network,
  method: string,
  args: object = {},
) {
  return query<T>(network, tokenFor(network), method, args);
}

export function explorerTx(hash: string) {
  return `https://testnet.nearblocks.io/txns/${hash}`;
}

/** Contract panics arrive wrapped in wallet and RPC text. This keeps the reason. */
export function reason(caught: unknown) {
  const text = caught instanceof Error ? caught.message : String(caught);
  const plain = text.replace(/\u001b\[[0-9;]*m/g, "");
  if (/does not exist on/i.test(plain) || /not a TTY/i.test(plain)) {
    return "Your testnet account is still being created. Wait a few seconds and try again.";
  }
  if (
    /send_tx does not exist|Exceeded \d+ providers|Transaction has expired|near_rpc_error/i.test(
      plain,
    )
  ) {
    return "The wallet could not broadcast this transaction. Approve it again.";
  }
  const match =
    plain.match(/Smart contract panicked: ([^"\\]+)/) ??
    plain.match(/panicked at [^:]+: ([^"\\]+)/);
  return (match?.[1] ?? plain).replace(/\s+/g, " ").trim().slice(0, 240);
}
