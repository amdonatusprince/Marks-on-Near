import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  dollars,
  liquidationPrice,
  sizedOrder,
  ticksFromDollars,
} from "../app/marks/lib/format";
import { contractSize } from "../app/marks/lib/markets";
import { needsRefresh, orderCalls } from "../app/marks/lib/order-plan";
import {
  market,
  markAge,
  money,
  price,
  trader,
  viewChain,
  type Level,
} from "../shared/marks";

export default defineAction({
  description:
    "Plan a Marks perp order exactly as the order ticket would: contracts, cost, margin taken from the Marks balance, liquidation price and the contract calls. Nothing is signed. To place it, call place-order with the returned ticket.",
  schema: z.object({
    accountId: z
      .string()
      .describe("NEAR account that will sign, from the Marks tab context."),
    symbol: z.string().describe("Market symbol, such as SOL-PERP."),
    side: z.enum(["long", "short"]).describe("long buys, short sells."),
    amount: z
      .string()
      .describe(
        "Order size in US dollars of notional, as typed in the ticket, such as 300.",
      ),
    price: z
      .string()
      .optional()
      .describe(
        "Limit price in dollars. Leave out to open now: a long takes the best ask, a short the best bid (the mark when that side is empty).",
      ),
    kind: z
      .enum(["limit", "post_only", "immediate_or_cancel"])
      .default("limit"),
  }),
  readOnly: true,
  mcpTool: true,
  run: async ({ accountId, symbol, side, amount, price: limit, kind }) => {
    const item = await market(symbol);
    const book = await viewChain<{ bids: Level[]; asks: Level[] }>("get_l2", {
      symbol: item.symbol,
      depth: 1,
    }).catch(() => ({ bids: [], asks: [] }));
    const bestBid = book.bids[0]?.ticks;
    const bestAsk = book.asks[0]?.ticks;
    const touch = side === "long" ? bestAsk : bestBid;
    const ticks = limit?.trim()
      ? ticksFromDollars(limit, item.tick_size)
      : BigInt(touch ?? item.mark_ticks);
    if (!ticks || ticks <= BigInt(0)) {
      return {
        ok: false,
        reason: "That price is not a positive dollar amount.",
      };
    }
    const sized = sizedOrder(amount, ticks, item.tick_size);
    if (!sized || sized.lots <= BigInt(0)) {
      return {
        ok: false,
        reason: `$${amount} is below one contract (${contractSize(item.symbol)}) at ${price(Number(ticks), item.tick_size)}.`,
      };
    }
    const chainSide = side === "long" ? "bid" : "ask";
    const fillsNow =
      touch !== undefined &&
      (side === "long" ? ticks >= BigInt(touch) : ticks <= BigInt(touch));
    const held = await trader(item.symbol, accountId);
    const entry = sized.cost / sized.lots;
    const liquidation = liquidationPrice(
      sized.margin,
      side === "long" ? sized.lots : -sized.lots,
      entry,
      item.maintenance_margin_bps,
    );
    const ticket = {
      symbol: item.symbol,
      side: chainSide,
      kind,
      price: limit?.trim() || dollars(Number(ticks), item.tick_size),
      amount,
    };
    const summary = {
      symbol: item.symbol,
      side,
      kind,
      contracts: Number(sized.lots),
      contractSize: contractSize(item.symbol),
      price: price(Number(ticks), item.tick_size),
      mark: price(item.mark_ticks, item.tick_size),
      bestBid: bestBid ? price(bestBid, item.tick_size) : null,
      bestAsk: bestAsk ? price(bestAsk, item.tick_size) : null,
      fillsNow: fillsNow
        ? "yes"
        : "no, it rests on the book until someone trades at that price",
      cost: money(sized.cost),
      estimatedLiquidation: liquidation ? money(liquidation) : null,
      priceRefreshFirst: needsRefresh(item),
      markAgeMinutes: markAge(item),
    };
    try {
      const plan = orderCalls(
        { symbol: item.symbol, side: chainSide, kind, ticks, lots: sized.lots },
        item,
        held,
      );
      return {
        ok: true,
        ...summary,
        marginFromBalance: money(plan.need),
        marksBalance: money(plan.balance),
        calls: plan.calls.map((call) => call.methodName),
        ticket,
        next: "Show this plan and say whether it fills now, then call place-order with the ticket fields. They press Open wallet on the Marks tab and sign; poll check-desk-job.",
      };
    } catch (error) {
      return {
        ok: false,
        ...summary,
        marksBalance: money(held.unallocated || "0"),
        reason: error instanceof Error ? error.message : String(error),
        fix: "Move mUSDC from the wallet into the Marks balance on the Portfolio page, or claim test mUSDC from the faucet, then plan again.",
      };
    }
  },
});
