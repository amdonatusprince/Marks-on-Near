import { GIFT_GAS } from "@/marks/lib/create-gift";
import {
  HEAVY_GAS,
  ONE_YOCTO,
  ORACLE_FEE,
  type SendOptions,
} from "@/marks/lib/near";
import type { Network } from "@/marks/lib/network";
import type { Market } from "@/marks/lib/rpc";
import { viewMarks, type Share } from "@/marks/lib/v2";

/**
 * The chain writes behind every Marks page button. The pages and the agent's
 * client actions both call these, so a write behaves the same from either.
 */
export type Send = (
  methodName: string,
  args: object,
  options?: SendOptions,
) => Promise<string>;

const TRANSFER_GAS = "100000000000000";
const SETTLE_GAS = "100000000000000";

/** Meteor reports a landed cross-contract call as near_rpc_error when its own status poll gives up. */
const WALLET_RPC =
  /near_rpc_error|completing the request|server error|-32000|did not finish|broadcast|timed? out/i;

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught);
}

/**
 * The wallet popup can fail after the transaction is already on chain. When the
 * error is from that poll, wait until the chain value moves and treat it as sent.
 */
async function settle(
  read: () => Promise<string>,
  sendTx: () => Promise<string>,
) {
  const before = await read().catch(() => "");
  try {
    return await sendTx();
  } catch (caught) {
    if (!before || !WALLET_RPC.test(messageOf(caught))) throw caught;
    const started = Date.now();
    while (Date.now() - started < 20_000) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const next = await read().catch(() => "");
      if (next && BigInt(next) > BigInt(before)) return "";
    }
    throw caught;
  }
}

export const refreshShare = (send: Send, assetId: string, network: Network) =>
  settle(
    () =>
      viewMarks<Share>(network, "get_share", { asset_id: assetId }).then(
        (share) => String(share.updated_ns),
      ),
    () =>
      send(
        "refresh_share",
        { asset_id: assetId },
        { deposit: ORACLE_FEE, gas: HEAVY_GAS },
      ),
  );

export const refreshMark = (send: Send, symbol: string, network: Network) =>
  settle(
    () =>
      viewMarks<Market>(network, "get_market", { symbol }).then(
        (market) => market.mark_updated_ns || "0",
      ),
    () =>
      send("refresh_mark", { symbol }, { deposit: ORACLE_FEE, gas: HEAVY_GAS }),
  );

export const buyShares = (send: Send, assetId: string, amount: bigint) =>
  send("buy_shares", { asset_id: assetId, amount: amount.toString() });

export const sellShares = (send: Send, assetId: string, units: bigint) =>
  send("sell_shares", { asset_id: assetId, units: units.toString() });

export const placeOption = (
  send: Send,
  order: {
    seriesId: string;
    side: "bid" | "ask";
    premium: bigint;
    lots: number;
  },
) =>
  send("place_option", {
    series_id: order.seriesId,
    side: order.side,
    premium: order.premium.toString(),
    lots: order.lots,
  });

export const settleSeries = (send: Send, seriesId: string) =>
  send("settle_series", { series_id: seriesId }, { gas: SETTLE_GAS });

export const claimSettlement = (send: Send, seriesId: string) =>
  send("claim_settlement", { series_id: seriesId });

export const borrowOnPosition = (
  send: Send,
  action: "borrow" | "repay",
  symbol: string,
  amount: bigint,
) => send(action, { symbol, amount: amount.toString() });

export const borrowAgainstShares = (
  send: Send,
  assetId: string,
  units: bigint,
  amount: bigint,
) =>
  send("borrow_against", {
    asset_id: assetId,
    units: units.toString(),
    amount: amount.toString(),
  });

export const repayShareLoan = (send: Send, assetId: string, amount: bigint) =>
  send("repay_share_loan", { asset_id: assetId, amount: amount.toString() });

export const cancelOrder = (send: Send, symbol: string, orderId: number) =>
  send("cancel_order", { symbol, order_id: orderId });

export const commitMargin = (send: Send, symbol: string, amount: bigint) =>
  send("commit", { symbol, amount: amount.toString() });

export const refundGift = (send: Send, giftId: number) =>
  send("refund_gift", { gift_id: giftId }, { gas: GIFT_GAS });

/** Voids an open gift now. The claim link stops working and the asset comes back. */
export const cancelGift = (send: Send, giftId: number) =>
  send("cancel_gift", { gift_id: giftId }, { gas: GIFT_GAS });

/** Open a gift into the recipient's account. The relayer pays when it is up. */
export async function claimGift(
  send: Send,
  giftId: number,
  recipient: string,
  signature: string,
) {
  const response = await fetch("/api/gift/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      gift_id: giftId,
      recipient,
      signature,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    hash?: string;
    error?: string;
  };
  if (response.ok && body.hash) return body.hash;
  return send(
    "claim_gift",
    { gift_id: giftId, recipient, signature },
    { gas: TRANSFER_GAS },
  );
}

export const depositToMarks = (
  send: Send,
  token: string,
  contract: string,
  amount: bigint,
) =>
  send(
    "ft_transfer_call",
    { receiver_id: contract, amount: amount.toString(), msg: "deposit" },
    { receiverId: token, deposit: ONE_YOCTO, gas: TRANSFER_GAS },
  );

export const withdrawFromMarks = (send: Send, amount: bigint) =>
  send("withdraw", { amount: amount.toString() }, { gas: TRANSFER_GAS });

/** Mints through the relayer; returns null when the account must claim for itself. */
export async function claimFaucetByRelay(account: string) {
  const response = await fetch("/api/faucet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account_id: account }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    hash?: string;
    error?: string;
  };
  if (response.ok && body.hash) return body.hash;
  if (response.status === 429) {
    throw new Error(
      "This account already claimed today. Come back in 24 hours.",
    );
  }
  if (
    response.status >= 500 &&
    /FunctionCall|unreachable/.test(body.error ?? "")
  ) {
    throw new Error("The faucet rejected this claim. Try again in 24 hours.");
  }
  return null;
}

/** With the relayer down, the account claims for itself and pays the gas. */
export const claimFaucetSelf = (send: Send, token: string) =>
  send("faucet", { account_id: null }, { receiverId: token });
