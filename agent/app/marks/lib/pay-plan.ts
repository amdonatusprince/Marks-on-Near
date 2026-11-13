import { SHARE_LTV_BPS, UNIT, fee, valueOf } from "@/marks/lib/v2";

const ceilDiv = (value: bigint, by: bigint) => (value + by - BigInt(1)) / by;

/** Shares that must be locked so `debt` stays within 50 percent of value. */
export function unitsForDebt(debt: bigint, price: bigint) {
  if (debt <= BigInt(0) || price <= BigInt(0)) return BigInt(0);
  const cover = ceilDiv(debt * BigInt(10_000), SHARE_LTV_BPS);
  return ceilDiv(cover * UNIT, price);
}

export type PaySource =
  | { kind: "balance" }
  | {
      kind: "perp";
      symbol: string;
      limit: bigint;
      debt: bigint;
      giftId: number | null;
    }
  | {
      kind: "share";
      assetId: string;
      price: bigint;
      owned: bigint;
      locked: bigint;
      debt: bigint;
      fresh: boolean;
    };

/** Extra principal still available if every free share is locked. Null when the price is stale. */
export function shareBorrowRoom(source: {
  price: bigint;
  owned: bigint;
  locked: bigint;
  debt: bigint;
  fresh: boolean;
}) {
  if (!source.fresh || source.price <= BigInt(0)) return null;
  const value = valueOf(source.owned + source.locked, source.price);
  const room = (value * SHARE_LTV_BPS) / BigInt(10_000);
  if (room <= source.debt) return BigInt(0);
  return ((room - source.debt) * BigInt(10_000)) / BigInt(10_100);
}

export function sourceKey(source: PaySource) {
  if (source.kind === "balance") return "balance";
  if (source.kind === "perp") return `perp:${source.symbol}`;
  return `share:${source.assetId}`;
}

export type PayPlan = {
  shortfall: bigint;
  fee: bigint;
  lock: bigint;
  debtAfter: bigint;
  error: "balance" | "gift" | "limit" | "stale" | "shares" | null;
};

/** What `pay` will do. A covered bill borrows nothing, whatever source was picked. */
export function planPayment(
  bill: bigint,
  balance: bigint,
  source: PaySource,
): PayPlan {
  const shortfall = bill > balance ? bill - balance : BigInt(0);
  if (shortfall === BigInt(0)) {
    const debt = source.kind === "balance" ? BigInt(0) : source.debt;
    return {
      shortfall,
      fee: BigInt(0),
      lock: BigInt(0),
      debtAfter: debt,
      error: null,
    };
  }
  const charge = fee(shortfall);
  if (source.kind === "balance") {
    return {
      shortfall,
      fee: BigInt(0),
      lock: BigInt(0),
      debtAfter: BigInt(0),
      error: "balance",
    };
  }
  if (source.kind === "perp") {
    if (source.giftId != null) {
      return {
        shortfall,
        fee: charge,
        lock: BigInt(0),
        debtAfter: source.debt,
        error: "gift",
      };
    }
    if (shortfall > source.limit) {
      return {
        shortfall,
        fee: charge,
        lock: BigInt(0),
        debtAfter: source.debt + shortfall + charge,
        error: "limit",
      };
    }
    return {
      shortfall,
      fee: charge,
      lock: BigInt(0),
      debtAfter: source.debt + shortfall + charge,
      error: null,
    };
  }
  if (!source.fresh || source.price <= BigInt(0)) {
    return {
      shortfall,
      fee: charge,
      lock: BigInt(0),
      debtAfter: source.debt,
      error: "stale",
    };
  }
  const debtAfter = source.debt + shortfall + charge;
  const need = unitsForDebt(debtAfter, source.price);
  const lock = need > source.locked ? need - source.locked : BigInt(0);
  if (lock > source.owned) {
    return { shortfall, fee: charge, lock, debtAfter, error: "shares" };
  }
  return { shortfall, fee: charge, lock, debtAfter, error: null };
}
