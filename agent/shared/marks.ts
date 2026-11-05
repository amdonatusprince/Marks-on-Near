import { figures, money, price } from "../app/marks/lib/format";
import type { PlanMarket, PlanTrader } from "../app/marks/lib/order-plan";

// The pages read the same variables through import.meta.env.
export const MARKS_CONTRACT =
  process.env.VITE_CONTRACT_ID || "marks2-6e889d.testnet";
export const MARKS_TOKEN = process.env.VITE_TOKEN_ID || "musdc-6e889d.testnet";
export const MARKS_RPC =
  process.env.VITE_TESTNET_RPC || "https://test.rpc.fastnear.com";

export type ChainMarket = PlanMarket & {
  category: string;
  maintenance_margin_bps: number;
  index_ticks: number;
  open_interest_lots: number;
  volume_quote: string;
  insurance: string;
};

export type ChainTrader = PlanTrader & {
  free_collateral: string;
  liquidation_quote_per_lot?: string | null;
  equity?: string;
  unrealized_pnl?: string;
  borrow_limit?: string;
  gift_id?: number | null;
};

export type Level = { ticks: number; lots: number };

export async function viewChain<T>(
  method: string,
  args: object = {},
  account = MARKS_CONTRACT,
): Promise<T> {
  const response = await fetch(MARKS_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "marks-agent",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: account,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });
  if (!response.ok) throw new Error(`NEAR RPC returned ${response.status}`);
  const body = (await response.json()) as {
    error?: { message?: string; data?: string };
    result?: { result?: number[]; error?: string };
  };
  if (body.error)
    throw new Error(body.error.data || body.error.message || "NEAR RPC error");
  if (body.result?.error) throw new Error(body.result.error);
  const bytes = body.result?.result;
  if (!bytes) throw new Error("NEAR RPC returned no result");
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as T;
}

export const markets = () => viewChain<ChainMarket[]>("get_markets");

export async function market(symbol: string) {
  const all = await markets();
  const found = all.find((item) => item.symbol === symbol.toUpperCase());
  if (!found) {
    throw new Error(
      `There is no ${symbol} market. Markets: ${all.map((item) => item.symbol).join(", ")}.`,
    );
  }
  return found;
}

export const trader = (symbol: string, accountId: string) =>
  viewChain<ChainTrader>("get_trader", { symbol, account_id: accountId });

export function percent(bps: number) {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

export function markAge(market: PlanMarket) {
  const ns =
    BigInt(Date.now()) * BigInt(1_000_000) -
    BigInt(market.mark_updated_ns || "0");
  return Math.max(0, Math.round(Number(ns / BigInt(60_000_000_000))));
}

export function marketSummary(item: ChainMarket) {
  return {
    symbol: item.symbol,
    category: item.category,
    mark:
      item.mark_ticks > 0
        ? price(item.mark_ticks, item.tick_size)
        : "No price yet",
    index:
      item.index_ticks > 0
        ? price(item.index_ticks, item.tick_size)
        : "No price yet",
    markAgeMinutes: markAge(item),
    openInterest: money(
      BigInt(item.open_interest_lots) *
        BigInt(item.mark_ticks) *
        BigInt(item.tick_size),
    ),
    volume: money(item.volume_quote),
    initialMargin: percent(item.initial_margin_bps),
    maintenanceMargin: percent(item.maintenance_margin_bps),
    deskPath: `/markets/${item.symbol}`,
  };
}

export function levels(rows: Level[], tickSize: string) {
  return rows.map((row) => ({
    price: price(row.ticks, tickSize),
    contracts: row.lots,
  }));
}

export { figures, money, price };
