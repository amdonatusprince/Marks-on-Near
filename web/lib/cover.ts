type Side = "bid" | "ask";

type Held = {
  collateral: bigint;
  debt: bigint;
  baseLots: bigint;
  entryQuote: bigint;
  openBidLots: bigint;
  openAskLots: bigint;
};

/** Extra collateral an order still needs, measured the way the contract measures it. */
export function marginShortfall(input: {
  collateral: bigint;
  debt: bigint;
  baseLots: bigint;
  entryQuote: bigint;
  openBidLots: bigint;
  openAskLots: bigint;
  side: Side;
  lots: bigint;
  orderQuote: bigint;
  markQuote: bigint;
  initialBps: number;
}): bigint {
  if (input.lots <= BigInt(0) || input.markQuote <= BigInt(0)) return BigInt(0);
  const held: Held = {
    collateral: input.collateral,
    debt: input.debt,
    baseLots: input.baseLots,
    entryQuote: input.entryQuote,
    openBidLots: input.openBidLots,
    openAskLots: input.openAskLots,
  };
  const filled = applyFill(held, input.side, input.lots, input.orderQuote);
  const resting: Held = {
    ...held,
    openBidLots: held.openBidLots + (input.side === "bid" ? input.lots : BigInt(0)),
    openAskLots: held.openAskLots + (input.side === "ask" ? input.lots : BigInt(0)),
  };
  const filledNeed = filled ? requirementGap(filled, input.markQuote, input.initialBps) : BigInt(0);
  const restingNeed = requirementGap(resting, input.markQuote, input.initialBps);
  return filledNeed > restingNeed ? filledNeed : restingNeed;
}

function requirementGap(account: Held, markQuote: bigint, initialBps: number): bigint {
  const unrealized =
    account.baseLots === BigInt(0)
      ? BigInt(0)
      : account.baseLots * (markQuote - account.entryQuote);
  const equity = account.collateral + unrealized - account.debt;
  const exposure = worstLots(account.baseLots, account.openBidLots, account.openAskLots);
  const initial = (exposure * markQuote * BigInt(initialBps)) / BigInt(10000);
  return equity >= initial ? BigInt(0) : initial - equity;
}

function worstLots(base: bigint, bids: bigint, asks: bigint): bigint {
  const long = abs(base + bids);
  const short = abs(base - asks);
  return long > short ? long : short;
}

function abs(value: bigint) {
  return value < BigInt(0) ? -value : value;
}

/** Mirrors `math::apply_fill`, including realized pnl landing in collateral. */
function applyFill(account: Held, side: Side, lots: bigint, quote: bigint): Held | null {
  if (lots <= BigInt(0)) return null;
  const delta = side === "bid" ? lots : -lots;
  if (account.baseLots === BigInt(0)) {
    return { ...account, baseLots: delta, entryQuote: quote };
  }
  const same =
    (account.baseLots > BigInt(0) && delta > BigInt(0)) ||
    (account.baseLots < BigInt(0) && delta < BigInt(0));
  if (same) {
    const oldAbs = abs(account.baseLots);
    const newAbs = oldAbs + lots;
    const entry = (oldAbs * account.entryQuote + lots * quote) / newAbs;
    return { ...account, baseLots: account.baseLots + delta, entryQuote: entry };
  }
  const oldAbs = abs(account.baseLots);
  const close = oldAbs < lots ? oldAbs : lots;
  const realized =
    account.baseLots > BigInt(0)
      ? (quote - account.entryQuote) * close
      : (account.entryQuote - quote) * close;
  const collateral = account.collateral + realized;
  if (lots < oldAbs) {
    return { ...account, collateral, baseLots: account.baseLots + delta };
  }
  if (lots === oldAbs) {
    return { ...account, collateral, baseLots: BigInt(0), entryQuote: BigInt(0) };
  }
  const remainder = lots - oldAbs;
  return {
    ...account,
    collateral,
    baseLots: side === "bid" ? remainder : -remainder,
    entryQuote: quote,
  };
}
