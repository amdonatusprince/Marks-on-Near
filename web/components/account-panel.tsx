"use client";

import { DepositPanel } from "@/components/deposit-panel";
import { money, quote } from "@/lib/format";
import { useNear } from "@/lib/near";
import { viewClient, type Trader } from "@/lib/rpc-client";
import { useEffect, useId, useState } from "react";

const control =
  "h-11 w-full rounded-md border border-border bg-background px-3 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";

export function AccountPanel({ symbol }: { symbol: string }) {
  const { account, network, openDialog, send } = useNear();
  const [tab, setTab] = useState<"position" | "orders" | "deposit">("position");
  const [trader, setTrader] = useState<Trader | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!account) {
      setTrader(null);
      return;
    }
    let cancelled = false;
    void viewClient<Trader>(network, "get_trader", { symbol, account_id: account })
      .then((next) => {
        if (!cancelled) setTrader(next);
      })
      .catch((caught) => {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : "Could not read the account");
      });
    return () => {
      cancelled = true;
    };
  }, [account, network, symbol]);

  return (
    <section className="shrink-0 rounded-lg border border-border bg-card">
      <div className="flex gap-1 border-b border-border px-2" role="tablist" aria-label="Account">
        {(
          [
            ["position", "Position"],
            ["orders", "Orders"],
            ["deposit", "Deposit"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={`h-11 px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring ${tab === value ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="p-4">
        {!account ? (
          <button
            type="button"
            className="text-sm text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            onClick={openDialog}
          >
            Sign in to view open positions
          </button>
        ) : tab === "position" ? (
          <Position trader={trader} error={error} symbol={symbol} send={send} />
        ) : tab === "orders" ? (
          <Orders trader={trader} symbol={symbol} send={send} />
        ) : (
          <DepositPanel />
        )}
      </div>
    </section>
  );
}

function Position({
  trader,
  error,
  symbol,
  send,
}: {
  trader: Trader | null;
  error: string;
  symbol: string;
  send: (method: string, args: object) => Promise<string>;
}) {
  const [amount, setAmount] = useState("");
  const [local, setLocal] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const id = useId();
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!trader) return <p className="text-sm text-muted-foreground">Reading the account…</p>;
  const side = trader.base_lots > 0 ? "Long" : trader.base_lots < 0 ? "Short" : "Flat";
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Stat label="Position" value={`${side} ${Math.abs(trader.base_lots)}`} />
        <Stat label="Collateral" value={quote(trader.collateral)} />
        <Stat label="Free" value={quote(trader.free_collateral)} />
        <Stat label="Unallocated" value={quote(trader.unallocated)} />
        <Stat
          label="Liquidation"
          value={
            trader.liquidation_quote_per_lot ? money(trader.liquidation_quote_per_lot) : "None"
          }
        />
      </dl>
      {trader.base_lots !== 0 && trader.liquidation_quote_per_lot ? (
        <p className="text-xs text-muted-foreground">
          The position closes if the price reaches {money(trader.liquidation_quote_per_lot)}.
        </p>
      ) : null}
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!/^\d+$/.test(amount) || amount === "0") {
            setLocal("Enter quote atoms to commit.");
            return;
          }
          setLocal("");
          setBusy(true);
          setNote("");
          void send("commit", { symbol, amount })
            .then(() => setNote("Committed"))
            .catch((caught) => setLocal(caught instanceof Error ? caught.message : "Commit failed"))
            .finally(() => setBusy(false));
        }}
      >
        <label htmlFor={id} className="text-sm text-muted-foreground">
          Commit quote atoms
        </label>
        <input
          id={id}
          className={control}
          inputMode="numeric"
          autoComplete="off"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        {local ? <p className="text-sm text-destructive">{local}</p> : null}
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="h-10 rounded-md border border-border px-4 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {busy ? "Committing" : "Commit"}
        </button>
      </form>
    </div>
  );
}

function Orders({
  trader,
  symbol,
  send,
}: {
  trader: Trader | null;
  symbol: string;
  send: (method: string, args: object) => Promise<string>;
}) {
  const [orderId, setOrderId] = useState("");
  const [local, setLocal] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const id = useId();
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {trader
          ? `Open bids ${trader.open_bid_lots}. Open asks ${trader.open_ask_lots}.`
          : "Reading open size…"}
      </p>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!/^\d+$/.test(orderId)) {
            setLocal("Enter the order id.");
            return;
          }
          setLocal("");
          setBusy(true);
          setNote("");
          void send("cancel_order", { symbol, order_id: Number(orderId) })
            .then(() => setNote("Cancelled"))
            .catch((caught) => setLocal(caught instanceof Error ? caught.message : "Cancel failed"))
            .finally(() => setBusy(false));
        }}
      >
        <label htmlFor={id} className="text-sm text-muted-foreground">
          Order id
        </label>
        <input
          id={id}
          className={control}
          inputMode="numeric"
          autoComplete="off"
          value={orderId}
          onChange={(event) => setOrderId(event.target.value)}
        />
        {local ? <p className="text-sm text-destructive">{local}</p> : null}
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="h-10 rounded-md border border-border px-4 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {busy ? "Cancelling" : "Cancel order"}
        </button>
      </form>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono">{value}</dd>
    </div>
  );
}
