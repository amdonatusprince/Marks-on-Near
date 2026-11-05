import { atomsFromDollars } from "@/marks/lib/format";
import { giftLink, newClaimKey, sealNote } from "@/marks/lib/gift-key";
import { holdSecret, saveLink, storageWorks } from "@/marks/lib/gift-vault";
import type { ContractCall, SendOptions } from "@/marks/lib/near";
import type { Network } from "@/marks/lib/network";
import type { Gift, GiftAsset, Share } from "@/marks/lib/v2";
import { UNIT, fee, viewMarks } from "@/marks/lib/v2";

export const GIFT_GAS = "100000000000000";
const SHARE_GAS = "50000000000000";
const ZERO = BigInt(0);
/** A share buy pays 1/200 extra so a small move before signing still covers the gift units. */
const PRICE_SLACK = BigInt(200);

export type GiftKind = "usdc" | "shares" | "position";

export type SendGiftInput = {
  kind: GiftKind;
  amount?: string;
  assetId?: string;
  symbol?: string;
  days?: 7 | 30 | 90;
  note?: string;
};

type Send = (
  methodName: string,
  args: object,
  options?: SendOptions,
) => Promise<string>;

export type GiftPlan = {
  asset: GiftAsset;
  spend: bigint;
  fee: bigint;
  balance: bigint;
  buyShares: { asset_id: string; amount: string } | null;
};

/** Reads the chain and checks the Marks balance before anything is signed. */
export async function prepareGift(opts: {
  account: string;
  network: Network;
  input: SendGiftInput;
}): Promise<GiftPlan> {
  const { asset, spend, value } = await planGift(
    opts.network,
    opts.account,
    opts.input,
  );
  const giftFee = fee(value);
  const trader = await viewMarks<{ unallocated?: string }>(
    opts.network,
    "get_trader",
    { symbol: "SOL-PERP", account_id: opts.account },
  ).catch(() => null);
  const balance = BigInt(trader?.unallocated ?? "0");
  if (spend + giftFee > balance) {
    throw new Error(
      `The Marks balance is ${dollarText(balance)} and this gift needs ${dollarText(spend + giftFee)}. Claim the faucet or deposit first.`,
    );
  }
  return {
    asset,
    spend,
    fee: giftFee,
    balance,
    buyShares:
      asset.kind === "shares" && spend > ZERO
        ? { asset_id: asset.asset_id, amount: spend.toString() }
        : null,
  };
}

function dollarText(atoms: bigint) {
  return `$${(Number(atoms) / 1e6).toFixed(2)}`;
}

export async function submitGift(opts: {
  account: string;
  network: Network;
  contract: string;
  origin: string;
  send: Send;
  /** When set, a share buy and the gift go out as one transaction and one signature. */
  sendMany?: (calls: ContractCall[]) => Promise<string>;
  asset: GiftAsset;
  days: 7 | 30 | 90;
  note: string;
  buyShares: { asset_id: string; amount: string } | null;
  onStep?: (step: string) => void;
}): Promise<{ giftId: number; link: string; tx: string; asset: GiftAsset }> {
  if (!storageWorks()) {
    throw new Error(
      "This browser blocked local storage, so a gift link cannot be kept.",
    );
  }
  const { secret, claimKey, keyProof } = newClaimKey(
    opts.contract,
    opts.account,
  );
  holdSecret(opts.contract, opts.account, claimKey, secret);
  opts.onStep?.("Sealing your note");
  const sealed = await sealNote(secret, opts.note);
  let asset = opts.asset;
  const giftArgs = () => ({
    asset,
    claim_key: claimKey,
    key_proof: keyProof,
    expiry_days: opts.days,
    note: sealed,
  });
  if (opts.buyShares && opts.sendMany) {
    opts.onStep?.("Buying and locking the shares");
    const tx = await opts.sendMany([
      { methodName: "buy_shares", args: opts.buyShares, gas: SHARE_GAS },
      { methodName: "create_gift", args: giftArgs(), gas: GIFT_GAS },
    ]);
    return finish(opts, claimKey, secret, tx, asset);
  }
  if (opts.buyShares) {
    opts.onStep?.("Buying the shares");
    await opts.send("buy_shares", opts.buyShares);
    if (asset.kind === "shares") {
      const after = await viewMarks<[string, string][]>(
        opts.network,
        "get_holdings",
        { account_id: opts.account },
      );
      const now = BigInt(Object.fromEntries(after)[asset.asset_id] ?? "0");
      const want = BigInt(asset.units);
      asset = {
        ...asset,
        units: (now < want ? now : want).toString(),
      };
    }
  }
  opts.onStep?.("Locking the gift");
  const tx = await opts.send("create_gift", giftArgs(), { gas: GIFT_GAS });
  return finish(opts, claimKey, secret, tx, asset);
}

async function finish(
  opts: {
    account: string;
    network: Network;
    contract: string;
    origin: string;
    onStep?: (step: string) => void;
  },
  claimKey: string,
  secret: string,
  tx: string,
  asset: GiftAsset,
) {
  opts.onStep?.("Finding your gift");
  const gift = await waitForGift(opts.network, opts.account, claimKey);
  const link = giftLink(opts.origin, gift.id, secret);
  saveLink(opts.contract, opts.account, claimKey, gift.id, link);
  return { giftId: gift.id, link, tx, asset };
}

async function planGift(
  network: Network,
  account: string,
  input: SendGiftInput,
): Promise<{ asset: GiftAsset; spend: bigint; value: bigint }> {
  if (input.kind === "usdc") {
    const amount = atomsFromDollars(input.amount ?? "");
    if (!amount || amount <= ZERO) {
      throw new Error("Enter how many dollars of USDC to gift, such as 25.");
    }
    return {
      asset: { kind: "usdc", amount: amount.toString() },
      spend: amount,
      value: amount,
    };
  }
  if (input.kind === "shares") {
    const assetId = (input.assetId ?? "").trim().toLowerCase();
    if (!assetId) throw new Error("Name the share to gift, such as nvda.");
    const amount = atomsFromDollars(input.amount ?? "");
    if (!amount || amount <= ZERO) {
      throw new Error("Enter how many dollars of shares to gift, such as 25.");
    }
    const share = await viewMarks<Share>(network, "get_share", {
      asset_id: assetId,
    });
    const price = BigInt(share.price);
    if (price <= ZERO) throw new Error(`No live price for ${assetId}.`);
    const giftUnits = (amount * UNIT) / price;
    if (giftUnits <= ZERO) {
      throw new Error("That amount is too small for one unit.");
    }
    const holdings = await viewMarks<[string, string][]>(
      network,
      "get_holdings",
      { account_id: account },
    ).catch(() => [] as [string, string][]);
    const held = BigInt(Object.fromEntries(holdings)[assetId] ?? "0");
    return {
      asset: {
        kind: "shares",
        asset_id: assetId,
        units: giftUnits.toString(),
      },
      spend: held < giftUnits ? amount + amount / PRICE_SLACK : ZERO,
      value: (giftUnits * price) / UNIT,
    };
  }
  const symbol = (input.symbol ?? "").trim().toUpperCase();
  if (!symbol) {
    throw new Error(
      "Name the market whose position to gift, such as SOL-PERP.",
    );
  }
  const trader = await viewMarks<{
    base_lots: number;
    gift_id?: number | null;
    equity?: string;
  }>(network, "get_trader", {
    symbol,
    account_id: account,
  }).catch(() => null);
  if (!trader || trader.base_lots === 0) {
    throw new Error(`You have no open position on ${symbol} to gift.`);
  }
  if (trader.gift_id != null) {
    throw new Error(`${symbol} is already locked in a gift.`);
  }
  return {
    asset: { kind: "position", symbol },
    spend: ZERO,
    value: BigInt(trader.equity ?? "0"),
  };
}

async function waitForGift(
  network: Network,
  account: string,
  claimKey: string,
) {
  let gift: Gift | undefined;
  for (let attempt = 0; attempt < 6 && !gift; attempt += 1) {
    const sent = await viewMarks<Gift[]>(network, "get_gifts_sent", {
      account_id: account,
    });
    gift = sent.find((item) => item.claim_key === claimKey);
    if (!gift) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (!gift) {
    throw new Error(
      "The gift was sent, but it is not listed yet. Reload in a minute.",
    );
  }
  return gift;
}
