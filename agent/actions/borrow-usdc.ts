import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { atomsFromDollars } from "../app/marks/lib/format";
import {
  units as formatUnits,
  unitsFromText,
  type Share,
  type ShareLoan,
} from "../app/marks/lib/v2";
import { deskAccount, runOnDesk } from "../server/marks/desk-tab";
import { money, trader, viewChain } from "../shared/marks";

const UNIT = BigInt(1_000_000);
const FEE_BPS = BigInt(100);
const LTV_BPS = BigInt(5_000);
const BPS = BigInt(10_000);

const ceilDiv = (a: bigint, b: bigint) => (a + b - BigInt(1)) / b;

type Args = {
  collateral: "position" | "shares";
  action: "borrow" | "repay";
  amount: string;
  symbol?: string | undefined;
  assetId?: string | undefined;
  units?: string | undefined;
};

/** The contract's borrow checks, so a loan it would reject never reaches the wallet. */
async function checkBorrow(args: Args, accountId: string) {
  const amount = atomsFromDollars(args.amount);
  if (!amount) return { error: "Say the USDC to borrow, such as 50." };
  if (args.collateral === "position") {
    const symbol = String(args.symbol ?? "").toUpperCase();
    const held = await trader(symbol, accountId);
    if (held.gift_id != null) {
      return {
        error: `The ${symbol} position is held for gift ${held.gift_id} and cannot back a loan until the gift is claimed or refunded.`,
      };
    }
    const limit = BigInt(held.borrow_limit ?? "0");
    if (amount > limit) {
      return {
        error: `The ${symbol} position can back up to ${money(limit)} right now.`,
      };
    }
    return { args };
  }
  const assetId = String(args.assetId ?? "").toLowerCase();
  const [shares, loan, holdings] = await Promise.all([
    viewChain<Share[]>("get_shares"),
    viewChain<ShareLoan>("get_share_loan", {
      account_id: accountId,
      asset_id: assetId,
    }),
    viewChain<[string, string][]>("get_holdings", { account_id: accountId }),
  ]);
  const share = shares.find((item) => item.asset_id === assetId);
  if (!share) return { error: `No Marks share called ${assetId}.` };
  const price = BigInt(share.price);
  const debt = BigInt(loan.debt) + amount + ceilDiv(amount * FEE_BPS, BPS);
  const needed = ceilDiv(ceilDiv(debt * BPS, LTV_BPS) * UNIT, price);
  const extra =
    needed > BigInt(loan.units) ? needed - BigInt(loan.units) : BigInt(0);
  const owned = BigInt(holdings.find(([id]) => id === assetId)?.[1] ?? "0");
  const asked = args.units ? unitsFromText(args.units) : null;
  const lock = asked && asked > extra ? asked : extra;
  if (lock > owned) {
    return {
      error: `Borrowing ${money(amount)} against ${assetId.toUpperCase()} needs ${formatUnits(lock, 6)} shares locked; this account holds ${formatUnits(owned, 6)}. Loans go up to 50 percent of share value, after the 1 percent fee.`,
    };
  }
  return { args: { ...args, units: formatUnits(lock, 6).replace(/,/g, "") } };
}

export default defineAction({
  description:
    "Borrow or repay USDC, same as /borrow. collateral position needs symbol. collateral shares needs assetId; units to lock is worked out from the oracle price when left out, and raised if too low (loans go up to 50 percent of share value, after a 1 percent fee). A position with get-account heldForGift set cannot back a loan. Returns jobId; poll check-desk-job.",
  schema: z.object({
    collateral: z.enum(["position", "shares"]),
    action: z.enum(["borrow", "repay"]),
    amount: z.string().describe("USDC dollars, such as 50."),
    symbol: z.string().optional().describe("Market for position collateral."),
    assetId: z.string().optional().describe("Share id for shares collateral."),
    units: z
      .string()
      .optional()
      .describe("Share units to lock when borrowing against shares."),
  }),
  run: async (args) => {
    if (args.action === "borrow") {
      const accountId = await deskAccount("borrow-usdc");
      if (accountId) {
        const checked = await checkBorrow(args, accountId);
        if ("error" in checked) return { ok: false, error: checked.error };
        return runOnDesk("borrow-usdc", checked.args);
      }
    }
    return runOnDesk("borrow-usdc", args);
  },
});
