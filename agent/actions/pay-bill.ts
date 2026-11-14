import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { atomsFromDollars, money } from "../app/marks/lib/format";
import {
  planPayment,
  sourceKey,
  type PaySource,
} from "../app/marks/lib/pay-plan";
import { isFresh, type Share, type ShareLoan } from "../app/marks/lib/v2";
import { deskAccount, runOnDesk } from "../server/marks/desk-tab";
import { paymentIdOk, readPayment } from "../server/marks/payments";
import { trader, viewChain } from "../shared/marks";

const NEAR_ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

function refusal(
  error: NonNullable<ReturnType<typeof planPayment>["error"]>,
  source: PaySource,
) {
  if (error === "balance")
    return "The Marks balance does not cover this bill. Name a position or shares to borrow the rest.";
  if (error === "gift" && source.kind === "perp")
    return `The ${source.symbol} position is in a gift and cannot back a bill.`;
  if (error === "limit" && source.kind === "perp")
    return `${source.symbol} cannot borrow enough to cover the rest of this bill. It can borrow ${money(source.limit)} more.`;
  if (error === "stale" && source.kind === "share")
    return `${source.assetId.toUpperCase()} needs a fresh price before it can back a bill.`;
  if (error === "shares" && source.kind === "share")
    return `${source.assetId.toUpperCase()} cannot cover this bill at 50 percent of its value.`;
  return "This bill cannot be paid from that asset.";
}

export default defineAction({
  description:
    "Pay a Marks testnet checkout. Pass paymentId to pay that payment link: the amount and merchant come from the link. Or pass amount and merchant directly. If the Marks balance covers the bill, it pays from the balance. Otherwise it borrows only the shortfall against collateral position (symbol) or shares (assetId) and pays in one signature. The 1 percent fee applies only to the borrowed part. A mainnet payment link is not a Marks write. Returns jobId; poll check-desk-job.",
  schema: z.object({
    paymentId: z
      .string()
      .optional()
      .describe("Payment link id. Amount and merchant come from the link."),
    amount: z
      .string()
      .optional()
      .describe("USDC dollars, such as 40. Omit when paymentId is set."),
    collateral: z.enum(["balance", "position", "shares"]),
    symbol: z
      .string()
      .optional()
      .describe("Market when collateral is position."),
    assetId: z
      .string()
      .optional()
      .describe("Share id when collateral is shares."),
    merchant: z
      .string()
      .optional()
      .describe(
        "NEAR account that receives the mUSDC. Omit when paymentId is set.",
      ),
    label: z
      .string()
      .optional()
      .describe("Bill name shown on the approval card."),
  }),
  run: async (args) => {
    let amount = args.amount ?? "";
    let merchant = args.merchant?.trim().toLowerCase() ?? "";
    const paymentId = args.paymentId?.trim() ?? "";
    if (paymentId) {
      if (!paymentIdOk(paymentId)) {
        return { ok: false, error: "That is not a payment link id." };
      }
      const payment = await readPayment(paymentId);
      if (!payment) {
        return { ok: false, error: "This payment link does not exist." };
      }
      if (payment.status === "paid") {
        return { ok: false, error: "This payment link is already paid." };
      }
      const end = payment.expiresAt ? Date.parse(payment.expiresAt) : NaN;
      if (!Number.isNaN(end) && end <= Date.now()) {
        return { ok: false, error: "This payment link has expired." };
      }
      if (!payment.recipient.endsWith(".testnet")) {
        return {
          ok: false,
          error:
            "This link pays a NEAR mainnet account. Open the checkout page. The person pays it from their own wallet through NEAR Intents.",
        };
      }
      amount = payment.amount;
      merchant = payment.recipient;
    }
    const bill = atomsFromDollars(amount);
    if (!bill) return { ok: false, error: "Say the bill in USDC, such as 40." };
    if (!NEAR_ACCOUNT.test(merchant) || merchant.length > 64) {
      return { ok: false, error: "The merchant has to be a NEAR account." };
    }
    const accountId = await deskAccount("pay-bill");
    if (!accountId) {
      return runOnDesk("pay-bill", {
        amount,
        source: "balance",
        merchant,
        label: args.label,
        ...(paymentId ? { paymentId } : {}),
      });
    }
    if (merchant === accountId.trim().toLowerCase()) {
      return { ok: false, error: "Pay someone else." };
    }
    const markets = await viewChain<{ symbol: string }[]>("get_markets");
    const first = markets[0]?.symbol;
    if (!first)
      return {
        ok: false,
        error: "Marks has no market to read a balance from.",
      };
    const wallet = await trader(first, accountId);
    const balance = BigInt(wallet.unallocated || "0");
    let source: PaySource;
    if (args.collateral === "position") {
      const symbol = String(args.symbol ?? "").toUpperCase();
      if (!symbol)
        return { ok: false, error: "Name the market, such as SOL-PERP." };
      const held = symbol === first ? wallet : await trader(symbol, accountId);
      source = {
        kind: "perp",
        symbol,
        limit: BigInt(held.borrow_limit ?? "0"),
        debt: BigInt(held.debt ?? "0"),
        giftId: held.gift_id ?? null,
      };
    } else if (args.collateral === "shares") {
      const assetId = String(args.assetId ?? "").toLowerCase();
      if (!assetId)
        return { ok: false, error: "Name the share, such as nvda." };
      const [shares, loan, holdings] = await Promise.all([
        viewChain<Share[]>("get_shares"),
        viewChain<ShareLoan>("get_share_loan", {
          account_id: accountId,
          asset_id: assetId,
        }),
        viewChain<[string, string][]>("get_holdings", {
          account_id: accountId,
        }),
      ]);
      const share = shares.find((item) => item.asset_id === assetId);
      if (!share)
        return { ok: false, error: `No Marks share called ${assetId}.` };
      source = {
        kind: "share",
        assetId,
        price: BigInt(share.price || "0"),
        owned: BigInt(holdings.find(([id]) => id === assetId)?.[1] ?? "0"),
        locked: BigInt(loan.units || "0"),
        debt: BigInt(loan.debt || "0"),
        fresh: isFresh(share),
      };
    } else {
      source = { kind: "balance" };
    }
    const plan = planPayment(bill, balance, source);
    if (plan.error) return { ok: false, error: refusal(plan.error, source) };
    return runOnDesk("pay-bill", {
      amount,
      source: sourceKey(source),
      merchant,
      label: args.label,
      borrowed: money(plan.shortfall),
      ...(paymentId ? { paymentId } : {}),
    });
  },
});
