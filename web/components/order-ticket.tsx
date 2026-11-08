"use client";

import { useToast } from "@/components/toast";
import { marginShortfall } from "@/lib/cover";
import {
  dollars,
  grouped,
  liquidationPrice,
  money,
  sizedOrder,
  ticksFromDollars,
} from "@/lib/format";
import { contractSize } from "@/lib/markets";
import { HEAVY_GAS, ORACLE_FEE, useNear, type ContractCall } from "@/lib/near";
import type { Network } from "@/lib/network";
import type { Market } from "@/lib/rpc";
import { viewClient, type Trader } from "@/lib/rpc-client";
import { explorerTx } from "@/lib/v2";
import { useEffect, useId, useRef, useState } from "react";

const control =
  "h-11 w-full rounded-md border border-border bg-background px-3 font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";

export function OrderTicket({
  symbol,
  markTicks,
  tickSize,
  price,
  side,
  maintenanceBps,
  initialMarginBps,
  onPrice,
  onSide,
}: {
  symbol: string;
  markTicks: number;
  tickSize: string;
  price: string;
  side: "bid" | "ask";
  maintenanceBps: number;
  initialMarginBps: number;
  onPrice: (value: string) => void;
  onSide: (side: "bid" | "ask") => void;
}) {
  const { account, network, openDialog, send, sendMany } = useNear();
  const toast = useToast();
  const [kind, setKind] = useState("limit");
  const [amount, setAmount] = useState("300");
  const [priceText, setPriceText] = useState(shownPrice(price, tickSize));
  const [busy, setBusy] = useState(false);
  const priceId = useId();
  const amountId = useId();
  const priceErrorId = useId();
  const amountErrorId = useId();
  const [priceError, setPriceError] = useState("");
  const [amountError, setAmountError] = useState("");
  const seenPrice = useRef(price);
  const long = side === "bid";
  const ticks = ticksFromDollars(priceText, tickSize);
  const sized = ticks ? sizedOrder(amount, ticks, tickSize) : null;
  const entry = sized && sized.lots > BigInt(0) ? sized.cost / sized.lots : null;
  const liquidation =
    sized && entry
      ? liquidationPrice(sized.margin, long ? sized.lots : -sized.lots, entry, maintenanceBps)
      : null;
  const unit = contractSize(symbol);

  useEffect(() => {
    if (price === seenPrice.current) return;
    seenPrice.current = price;
    setPriceText(shownPrice(price, tickSize));
  }, [price, tickSize]);

  return (
    <section className="rounded-lg border border-border bg-card p-4 md:min-h-full">
      <div className="grid grid-cols-3 gap-2 text-sm" role="tablist" aria-label="Order kind">
        {(
          [
            ["limit", "Limit"],
            ["post_only", "Post only"],
            ["immediate_or_cancel", "IOC"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={kind === value}
            className={`h-10 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card ${kind === value ? "bg-muted font-medium" : "text-muted-foreground"}`}
            onClick={() => setKind(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <fieldset className="mt-4">
        <legend className="sr-only">Side</legend>
        <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-1">
          <button
            type="button"
            className={`h-11 rounded-md text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring ${long ? "bg-bid text-bid-foreground" : "text-muted-foreground"}`}
            aria-pressed={long}
            onClick={() => onSide("bid")}
          >
            Long/Buy
          </button>
          <button
            type="button"
            className={`h-11 rounded-md text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring ${long ? "text-muted-foreground" : "bg-ask text-ask-foreground"}`}
            aria-pressed={!long}
            onClick={() => onSide("ask")}
          >
            Short/Sell
          </button>
        </div>
      </fieldset>
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const nextTicks = ticksFromDollars(priceText, tickSize);
          const nextSized = nextTicks ? sizedOrder(amount, nextTicks, tickSize) : null;
          const nextPrice = nextTicks ? "" : "Enter a price.";
          const nextAmount =
            nextSized && nextSized.lots > BigInt(0)
              ? ""
              : "That amount is below one contract at this price.";
          setPriceError(nextPrice);
          setAmountError(nextAmount);
          if (!nextTicks || !nextSized || nextSized.lots <= BigInt(0)) return;
          if (!account) {
            openDialog();
            return;
          }
          setBusy(true);
          void place(account, {
            symbol,
            side,
            kind,
            ticks: nextTicks,
            lots: nextSized.lots,
            initialMarginBps,
            network,
            send,
            sendMany,
            onRefresh: () =>
              toast.info(
                "This price is over an hour old. Approve the refresh, then approve the order.",
              ),
          })
            .then((tx) => {
              window.dispatchEvent(new Event("marks-traded"));
              if (tx) {
                toast.success("Order placed.", {
                  href: explorerTx(tx),
                  label: "View the transaction",
                });
              } else toast.success("Order placed.");
            })
            .catch((caught) =>
              toast.error(caught instanceof Error ? caught.message : "The order failed"),
            )
            .finally(() => setBusy(false));
        }}
      >
        <div>
          <label htmlFor={priceId} className="text-sm text-muted-foreground">
            Price
          </label>
          <input
            id={priceId}
            className={control}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder={markTicks ? dollars(markTicks, tickSize) : "0.00"}
            value={priceText}
            aria-invalid={priceError ? true : undefined}
            aria-describedby={priceError ? priceErrorId : undefined}
            onChange={(event) => {
              setPriceText(event.target.value);
              const next = ticksFromDollars(event.target.value, tickSize);
              if (next) {
                const text = next.toString();
                seenPrice.current = text;
                onPrice(text);
              }
            }}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {unit ? `USDC per contract. 1 contract = ${unit}.` : "USDC per contract."}
          </p>
          {priceError ? (
            <p id={priceErrorId} className="mt-1 text-sm text-destructive">
              {priceError}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor={amountId} className="text-sm text-muted-foreground">
            Amount
          </label>
          <input
            id={amountId}
            className={control}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="300"
            value={amount}
            aria-invalid={amountError ? true : undefined}
            aria-describedby={amountError ? amountErrorId : undefined}
            onChange={(event) => setAmount(event.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {sized && sized.lots > BigInt(0)
              ? `${grouped(sized.lots)} ${sized.lots === BigInt(1) ? "contract" : "contracts"}, ${money(sized.cost)}. Margin ${money(sized.margin)}, drawn from your Marks balance.${
                  liquidation ? ` Liquidation about ${money(liquidation)}.` : ""
                }`
              : sized
                ? "That amount is below one contract at this price."
                : "Type a USDC amount. The ticket buys as many whole contracts as that covers."}
          </p>
          {amountError ? (
            <p id={amountErrorId} className="mt-1 text-sm text-destructive">
              {amountError}
            </p>
          ) : null}
        </div>
        {account ? null : (
          <p className="text-sm text-muted-foreground">
            Sign in to place this order. You can still fill the ticket.
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          aria-busy={busy}
          className={`h-11 w-full rounded-md text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-50 ${long ? "bg-bid text-bid-foreground" : "bg-ask text-ask-foreground"}`}
        >
          {busy ? "Submitting" : account ? (long ? "Buy / Long" : "Sell / Short") : "Sign in"}
        </button>
      </form>
    </section>
  );
}

function shownPrice(ticks: string, tickSize: string) {
  return /^\d+$/.test(ticks) && ticks !== "0" ? dollars(Number(ticks), tickSize) : "";
}

const PLACE_GAS = "100000000000000";
/** Inside the contract's one-hour window, so a trade refreshes before the chain rejects it. */
const STALE_AFTER_NS = BigInt("3000000000000");

async function freshMark(
  network: Network,
  symbol: string,
  send: (
    methodName: string,
    args: object,
    options?: { gas?: string; deposit?: string },
  ) => Promise<string>,
  onRefresh: () => void,
) {
  const market = await viewClient<Market>(network, "get_market", { symbol });
  const updated = BigInt(market.mark_updated_ns || "0");
  const now = BigInt(Date.now()) * BigInt(1_000_000);
  if (market.mark_ticks > 0 && now - updated <= STALE_AFTER_NS) {
    return { markTicks: market.mark_ticks, tickSize: market.tick_size };
  }
  onRefresh();
  await send("refresh_mark", { symbol }, { deposit: ORACLE_FEE, gas: HEAVY_GAS });
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const next = await viewClient<Market>(network, "get_market", { symbol }).catch(() => null);
    if (next && BigInt(next.mark_updated_ns || "0") > updated && next.mark_ticks > 0) {
      return { markTicks: next.mark_ticks, tickSize: next.tick_size };
    }
  }
  throw new Error(
    "The price feed did not update. Approve the refresh again, then place the order.",
  );
}

async function place(
  account: string,
  input: {
    symbol: string;
    side: "bid" | "ask";
    kind: string;
    ticks: bigint;
    lots: bigint;
    initialMarginBps: number;
    network: Network;
    send: (
      methodName: string,
      args: object,
      options?: { gas?: string; deposit?: string },
    ) => Promise<string>;
    sendMany: (calls: ContractCall[]) => Promise<string>;
    onRefresh: () => void;
  },
) {
  const mark = await freshMark(input.network, input.symbol, input.send, input.onRefresh);
  let trader: Trader;
  try {
    trader = await viewClient<Trader>(input.network, "get_trader", {
      symbol: input.symbol,
      account_id: account,
    });
  } catch {
    throw new Error("Could not read the margin on this market.");
  }
  const tick = BigInt(mark.tickSize);
  const need = marginShortfall({
    collateral: BigInt(trader.collateral || "0"),
    debt: BigInt(trader.debt || "0"),
    baseLots: BigInt(trader.base_lots || 0),
    entryQuote: BigInt(trader.entry_quote_per_lot || "0"),
    openBidLots: BigInt(trader.open_bid_lots || 0),
    openAskLots: BigInt(trader.open_ask_lots || 0),
    side: input.side,
    lots: input.lots,
    orderQuote: input.ticks * tick,
    markQuote: BigInt(mark.markTicks) * tick,
    initialBps: input.initialMarginBps,
  });
  const balance = BigInt(trader.unallocated || "0");
  if (need > balance) {
    throw new Error(
      `This order needs ${money(need)} of margin and your Marks balance has ${money(balance)}.`,
    );
  }
  const order: ContractCall = {
    methodName: "place_order",
    args: {
      symbol: input.symbol,
      side: input.side,
      kind: input.kind,
      ticks: Number(input.ticks),
      lots: Number(input.lots),
    },
    gas: PLACE_GAS,
  };
  if (need === BigInt(0)) return input.sendMany([order]);
  return input.sendMany([
    { methodName: "commit", args: { symbol: input.symbol, amount: need.toString() } },
    order,
  ]);
}
