import { marginShortfall } from "./cover";
import { money } from "./format";

export const ORACLE_FEE = "20000000000000000000000";
export const HEAVY_GAS = "300000000000000";
export const PLACE_GAS = "100000000000000";
/** Inside the contract's one-hour window, so a trade refreshes before the chain rejects it. */
export const STALE_AFTER_NS = BigInt("3000000000000");

export type Side = "bid" | "ask";
export type OrderKind = "limit" | "post_only" | "immediate_or_cancel";

export type PlanCall = {
  methodName: string;
  args: Record<string, unknown>;
  gas?: string;
  deposit?: string;
};

export type PlanMarket = {
  symbol: string;
  tick_size: string;
  mark_ticks: number;
  mark_updated_ns: string;
  initial_margin_bps: number;
};

export type PlanTrader = {
  collateral: string;
  unallocated: string;
  base_lots: number;
  open_bid_lots: number;
  open_ask_lots: number;
  entry_quote_per_lot?: string;
  debt?: string;
};

export type OrderIntent = {
  symbol: string;
  side: Side;
  kind: OrderKind;
  ticks: bigint;
  lots: bigint;
};

export function nowNs() {
  return BigInt(Date.now()) * BigInt(1_000_000);
}

export function markAgeNs(market: PlanMarket, now = nowNs()) {
  return now - BigInt(market.mark_updated_ns || "0");
}

export function needsRefresh(market: PlanMarket, now = nowNs()) {
  return market.mark_ticks <= 0 || markAgeNs(market, now) > STALE_AFTER_NS;
}

export function refreshCall(symbol: string): PlanCall {
  return {
    methodName: "refresh_mark",
    args: { symbol },
    deposit: ORACLE_FEE,
    gas: HEAVY_GAS,
  };
}

/** The margin this order needs from the Marks balance, and the calls that place it. */
export function orderCalls(
  intent: OrderIntent,
  market: PlanMarket,
  trader: PlanTrader,
) {
  const tick = BigInt(market.tick_size);
  const need = marginShortfall({
    collateral: BigInt(trader.collateral || "0"),
    debt: BigInt(trader.debt || "0"),
    baseLots: BigInt(trader.base_lots || 0),
    entryQuote: BigInt(trader.entry_quote_per_lot || "0"),
    openBidLots: BigInt(trader.open_bid_lots || 0),
    openAskLots: BigInt(trader.open_ask_lots || 0),
    side: intent.side,
    lots: intent.lots,
    orderQuote: intent.ticks * tick,
    markQuote: BigInt(market.mark_ticks) * tick,
    initialBps: market.initial_margin_bps,
  });
  const balance = BigInt(trader.unallocated || "0");
  if (need > balance) {
    throw new Error(
      `This order needs ${money(need)} of margin and your Marks balance has ${money(balance)}.`,
    );
  }
  const order: PlanCall = {
    methodName: "place_order",
    args: {
      symbol: intent.symbol,
      side: intent.side,
      kind: intent.kind,
      ticks: Number(intent.ticks),
      lots: Number(intent.lots),
    },
    gas: PLACE_GAS,
  };
  const calls: PlanCall[] =
    need === BigInt(0)
      ? [order]
      : [
          {
            methodName: "commit",
            args: { symbol: intent.symbol, amount: need.toString() },
          },
          order,
        ];
  return { need, balance, calls };
}
