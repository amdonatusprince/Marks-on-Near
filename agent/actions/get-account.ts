import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  shareTicker,
  units,
  type Gift,
  type GiftAsset,
} from "../app/marks/lib/v2";
import {
  MARKS_TOKEN,
  markets,
  money,
  price,
  trader,
  viewChain,
  type Level,
} from "../shared/marks";

const giftAsset = (asset: GiftAsset) => {
  if (asset.kind === "usdc")
    return { kind: "usdc", amount: money(asset.amount) };
  if (asset.kind === "shares") {
    return {
      kind: "shares",
      ticker: shareTicker(asset.asset_id),
      shares: units(asset.units, 6),
    };
  }
  return asset;
};

type Order = {
  id: number;
  trader: string;
  side: "bid" | "ask";
  kind: string;
  ticks: number;
  lots: number;
};

const SCAN_BATCH = 10;
const SCAN_LIMIT = 3000;

async function openOrders(
  symbol: string,
  tickSize: string,
  accountId: string,
  wanted: number,
) {
  const book = await viewChain<{ bids: Level[]; asks: Level[] }>("get_l2", {
    symbol,
    depth: 1000,
  });
  const onBook = [...book.bids, ...book.asks].reduce(
    (sum, level) => sum + level.lots,
    0,
  );
  const mine: Order[] = [];
  let seen = 0;
  for (let start = 1; start <= SCAN_LIMIT; start += SCAN_BATCH) {
    const batch = await Promise.all(
      Array.from({ length: SCAN_BATCH }, (_, i) =>
        viewChain<Order | null>("get_order", {
          symbol,
          order_id: start + i,
        }).catch(() => null),
      ),
    );
    for (const order of batch) {
      if (!order) continue;
      seen += order.lots;
      if (order.trader === accountId) mine.push(order);
    }
    const found = mine.reduce((sum, order) => sum + order.lots, 0);
    if (found >= wanted || seen >= onBook) break;
  }
  return mine.map((order) => ({
    orderId: order.id,
    side: order.side === "bid" ? "buy" : "sell",
    contracts: order.lots,
    price: price(order.ticks, tickSize),
    kind: order.kind,
  }));
}

export default defineAction({
  description:
    "Read a NEAR account on Marks: wallet mUSDC, Marks balance (free to trade), every open position and resting order with its orderId (for cancel-order), share holdings, liquidation prices, and gifts they sent. Take accountId from the Marks tab context (view-browser-session) when the person has a wallet connected.",
  schema: z.object({
    accountId: z.string().describe("NEAR account id, such as alice.testnet."),
  }),
  readOnly: true,
  mcpTool: true,
  run: async ({ accountId }) => {
    const [all, wallet, holdings, gifts] = await Promise.all([
      markets(),
      viewChain<string>(
        "ft_balance_of",
        { account_id: accountId },
        MARKS_TOKEN,
      ).catch(() => "0"),
      viewChain<[string, string][]>("get_holdings", {
        account_id: accountId,
      }).catch(() => []),
      viewChain<Gift[]>("get_gifts_sent", {
        account_id: accountId,
      }).catch(() => [] as Gift[]),
    ]);
    const traders = await Promise.all(
      all.map(async (item) => ({
        item,
        held: await trader(item.symbol, accountId),
      })),
    );
    const balance = traders[0]?.held.unallocated ?? "0";
    const active = traders.filter(
      ({ held }) =>
        held.base_lots !== 0 ||
        held.open_bid_lots > 0 ||
        held.open_ask_lots > 0 ||
        BigInt(held.collateral || "0") > BigInt(0),
    );
    const orders = await Promise.all(
      active.map(({ item, held }) => {
        const wanted = held.open_bid_lots + held.open_ask_lots;
        return wanted > 0
          ? openOrders(item.symbol, item.tick_size, accountId, wanted).catch(
              () => null,
            )
          : [];
      }),
    );
    const positions = active.map(({ item, held }, index) => ({
      symbol: item.symbol,
      side: held.base_lots > 0 ? "long" : held.base_lots < 0 ? "short" : "flat",
      contracts: Math.abs(held.base_lots),
      entry: held.entry_quote_per_lot ? money(held.entry_quote_per_lot) : null,
      mark: price(item.mark_ticks, item.tick_size),
      margin: money(held.collateral),
      equity: held.equity ? money(held.equity) : null,
      unrealizedPnl: held.unrealized_pnl ? money(held.unrealized_pnl) : null,
      liquidation: held.liquidation_quote_per_lot
        ? money(held.liquidation_quote_per_lot)
        : null,
      debt: held.debt && held.debt !== "0" ? money(held.debt) : null,
      restingBuyContracts: held.open_bid_lots,
      restingSellContracts: held.open_ask_lots,
      openOrders: orders[index],
      heldForGift: held.gift_id ?? null,
    }));
    return {
      accountId,
      walletMusdc: money(wallet),
      marksBalance: money(balance),
      positions,
      shares: holdings.map(([asset, raw]) => ({
        asset,
        ticker: shareTicker(asset),
        shares: units(raw, 6),
      })),
      gifts: gifts.map((gift) => ({
        id: gift.id,
        status: gift.status,
        asset: giftAsset(gift.asset),
        fee: money(gift.fee),
        expires: new Date(gift.expiry_ns / 1e6).toISOString(),
        recipient: gift.recipient,
      })),
      sendPath: "/send",
      portfolioPath: "/portfolio",
    };
  },
});
