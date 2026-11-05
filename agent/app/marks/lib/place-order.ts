import { refreshMark } from "@/marks/lib/desk-writes";
import type { ContractCall } from "@/marks/lib/near";
import type { Network } from "@/marks/lib/network";
import {
  needsRefresh,
  orderCalls,
  type OrderIntent,
  type PlanMarket,
  type PlanTrader,
} from "@/marks/lib/order-plan";
import type { Market } from "@/marks/lib/rpc";
import { viewClient, type Trader } from "@/marks/lib/rpc-client";

type Send = (
  methodName: string,
  args: object,
  options?: { gas?: string | undefined; deposit?: string | undefined },
) => Promise<string>;

/** The one order path. The ticket button and the agent both call this. */
export async function placeOrder(input: {
  account: string;
  network: Network;
  intent: OrderIntent;
  send: Send;
  sendMany: (calls: ContractCall[]) => Promise<string>;
  onRefresh: () => void;
  /** Runs after a price refresh, before the order asks the wallet again. */
  afterRefresh?: () => Promise<void>;
}) {
  let refreshed = false;
  const market = await freshMarket(
    input.network,
    input.intent.symbol,
    input.send,
    () => {
      refreshed = true;
      input.onRefresh();
    },
  );
  if (refreshed && input.afterRefresh) await input.afterRefresh();
  let trader: Trader;
  try {
    trader = await viewClient<Trader>(input.network, "get_trader", {
      symbol: input.intent.symbol,
      account_id: input.account,
    });
  } catch {
    throw new Error("Could not read the margin on this market.");
  }
  const plan = orderCalls(input.intent, market, trader as PlanTrader);
  const tx = await input.sendMany(plan.calls);
  return { tx, need: plan.need };
}

async function freshMarket(
  network: Network,
  symbol: string,
  send: Send,
  onRefresh: () => void,
): Promise<PlanMarket> {
  const market = await viewClient<Market>(network, "get_market", { symbol });
  if (!needsRefresh(market)) return market;
  onRefresh();
  await refreshMark(send, symbol, network);
  const updated = BigInt(market.mark_updated_ns || "0");
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const next = await viewClient<Market>(network, "get_market", {
      symbol,
    }).catch(() => null);
    if (
      next &&
      BigInt(next.mark_updated_ns || "0") > updated &&
      next.mark_ticks > 0
    ) {
      return next;
    }
  }
  throw new Error(
    "The price feed did not update. Approve the refresh again, then place the order.",
  );
}
