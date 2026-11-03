"use client";

import { dollars, quote } from "@/lib/format";
import { useNear } from "@/lib/near";
import { useId, useState } from "react";

const control =
  "h-11 w-full rounded-md border border-border bg-background px-3 font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";

export function OrderTicket({
  symbol,
  markTicks,
  tickSize,
  price,
  side,
  onPrice,
  onSide,
}: {
  symbol: string;
  markTicks: number;
  tickSize: string;
  price: string;
  side: "bid" | "ask";
  onPrice: (value: string) => void;
  onSide: (side: "bid" | "ask") => void;
}) {
  const { account, openDialog, send } = useNear();
  const [kind, setKind] = useState("limit");
  const [lots, setLots] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hash, setHash] = useState("");
  const priceId = useId();
  const lotsId = useId();
  const priceErrorId = useId();
  const lotsErrorId = useId();
  const [priceError, setPriceError] = useState("");
  const [lotsError, setLotsError] = useState("");
  const long = side === "bid";
  const notional = notionalOf(price, lots, tickSize);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
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
          const nextPrice = positive(price) ? "" : "Enter a price in ticks.";
          const nextLots = positive(lots) ? "" : "Enter a size in lots.";
          setPriceError(nextPrice);
          setLotsError(nextLots);
          if (nextPrice || nextLots) return;
          if (!account) {
            openDialog();
            return;
          }
          setBusy(true);
          setError("");
          setHash("");
          void send("place_order", { symbol, side, kind, ticks: Number(price), lots: Number(lots) })
            .then((tx) => setHash(tx || "Submitted"))
            .catch((caught) =>
              setError(caught instanceof Error ? caught.message : "The order failed"),
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
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            placeholder={String(markTicks)}
            value={price}
            aria-invalid={priceError ? true : undefined}
            aria-describedby={priceError ? priceErrorId : undefined}
            onChange={(event) => onPrice(event.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {positive(price) ? `${dollars(Number(price), tickSize)} USDC per lot` : "Ticks"}
          </p>
          {priceError ? (
            <p id={priceErrorId} className="mt-1 text-sm text-destructive">
              {priceError}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor={lotsId} className="text-sm text-muted-foreground">
            Size
          </label>
          <input
            id={lotsId}
            className={control}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            placeholder="1"
            value={lots}
            aria-invalid={lotsError ? true : undefined}
            aria-describedby={lotsError ? lotsErrorId : undefined}
            onChange={(event) => setLots(event.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Lots.{" "}
            {notional ? `Notional ${notional} USDC` : "Notional appears after price and size."}
          </p>
          {lotsError ? (
            <p id={lotsErrorId} className="mt-1 text-sm text-destructive">
              {lotsError}
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
        {hash ? (
          <p className="break-all font-mono text-xs text-muted-foreground">Transaction {hash}</p>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function positive(value: string) {
  return /^\d+$/.test(value) && value !== "0";
}

function notionalOf(ticks: string, lots: string, tickSize: string) {
  if (!positive(ticks) || !positive(lots)) return "";
  const atoms = BigInt(ticks) * BigInt(lots) * BigInt(tickSize);
  return quote(atoms.toString());
}
