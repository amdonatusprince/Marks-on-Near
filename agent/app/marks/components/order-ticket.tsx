import { useToast } from "@/marks/components/toast";
import {
  TICKET_FILL,
  takePendingFill,
  type TicketFill,
} from "@/marks/lib/agent-events";
import {
  dollars,
  grouped,
  liquidationPrice,
  money,
  sizedOrder,
  ticksFromDollars,
} from "@/marks/lib/format";
import { contractSize } from "@/marks/lib/markets";
import { useNear } from "@/marks/lib/near";
import type { OrderKind } from "@/marks/lib/order-plan";
import { placeOrder } from "@/marks/lib/place-order";
import { explorerTx } from "@/marks/lib/v2";
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
  onPrice,
  onSide,
}: {
  symbol: string;
  markTicks: number;
  tickSize: string;
  price: string;
  side: "bid" | "ask";
  maintenanceBps: number;
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
  const entry =
    sized && sized.lots > BigInt(0) ? sized.cost / sized.lots : null;
  const liquidation =
    sized && entry
      ? liquidationPrice(
          sized.margin,
          long ? sized.lots : -sized.lots,
          entry,
          maintenanceBps,
        )
      : null;
  const unit = contractSize(symbol);

  useEffect(() => {
    if (price === seenPrice.current) return;
    seenPrice.current = price;
    setPriceText(shownPrice(price, tickSize));
  }, [price, tickSize]);

  useEffect(() => {
    const apply = (next: TicketFill) => {
      takePendingFill(symbol);
      onSide(next.side);
      if (next.kind) setKind(next.kind);
      if (next.price) setPriceText(next.price);
      if (next.amount) setAmount(next.amount);
      setPriceError("");
      setAmountError("");
    };
    const waiting = takePendingFill(symbol);
    if (waiting) apply(waiting);
    const fill = (event: Event) => {
      const next = (event as CustomEvent<TicketFill>).detail;
      if (next.symbol === symbol) apply(next);
    };
    window.addEventListener(TICKET_FILL, fill);
    return () => window.removeEventListener(TICKET_FILL, fill);
  }, [symbol, onSide]);

  return (
    <section className="rounded-lg border border-border bg-card p-4 md:min-h-full">
      <div
        className="grid grid-cols-3 gap-2 text-sm"
        role="tablist"
        aria-label="Order kind"
      >
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
          const nextSized = nextTicks
            ? sizedOrder(amount, nextTicks, tickSize)
            : null;
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
          void placeOrder({
            account,
            network,
            intent: {
              symbol,
              side,
              kind: kind as OrderKind,
              ticks: nextTicks,
              lots: nextSized.lots,
            },
            send,
            sendMany,
            onRefresh: () =>
              toast.info(
                "This price is over an hour old. Approve the refresh, then approve the order.",
              ),
          })
            .then(({ tx }) => {
              window.dispatchEvent(new Event("marks-traded"));
              if (tx) {
                toast.success("Order placed.", {
                  href: explorerTx(tx),
                  label: "View the transaction",
                });
              } else toast.success("Order placed.");
            })
            .catch((caught) =>
              toast.error(
                caught instanceof Error ? caught.message : "The order failed",
              ),
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
            {unit
              ? `USDC per contract. 1 contract = ${unit}.`
              : "USDC per contract."}
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
          {busy
            ? "Submitting"
            : account
              ? long
                ? "Buy / Long"
                : "Sell / Short"
              : "Sign in"}
        </button>
      </form>
    </section>
  );
}

function shownPrice(ticks: string, tickSize: string) {
  return /^\d+$/.test(ticks) && ticks !== "0"
    ? dollars(Number(ticks), tickSize)
    : "";
}
