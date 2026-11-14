import { DepositPanel } from "@/marks/components/deposit-panel";
import { useNotify, useToast } from "@/marks/components/toast";
import { Spinner } from "@/marks/components/v2-ui";
import { atomsFromDollars, grouped, money } from "@/marks/lib/format";
import Link from "@/marks/components/link";
import { cancelOrder, commitMargin } from "@/marks/lib/desk-writes";
import { useNear } from "@/marks/lib/near";
import { viewClient, type Trader } from "@/marks/lib/rpc-client";
import { useEffect, useId, useState } from "react";

const control =
  "h-11 w-full rounded-md border border-border bg-background px-3 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";

export function AccountPanel({ symbol }: { symbol: string }) {
  const { account, network, openDialog, send } = useNear();
  const [tab, setTab] = useState<"position" | "orders" | "deposit">("position");
  const [trader, setTrader] = useState<Trader | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useNotify(error);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("marks-traded", refresh);
    return () => window.removeEventListener("marks-traded", refresh);
  }, []);

  useEffect(() => {
    if (!account) {
      setTrader(null);
      setError("");
      return;
    }
    setError("");
    let cancelled = false;
    void viewClient<Trader>(network, "get_trader", {
      symbol,
      account_id: account,
    })
      .then((next) => {
        if (!cancelled) {
          setTrader(next);
          setError("");
        }
      })
      .catch((caught) => {
        if (!cancelled)
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not read the account",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [account, network, symbol, revision]);

  return (
    <section className="shrink-0 rounded-lg border border-border bg-card">
      <div
        className="flex gap-1 border-b border-border px-2"
        role="tablist"
        aria-label="Account"
      >
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
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  if (error)
    return (
      <p className="text-sm text-ink-muted">
        The position could not be loaded.
      </p>
    );
  if (!trader) return <Spinner />;
  const side =
    trader.base_lots > 0 ? "Long" : trader.base_lots < 0 ? "Short" : "Flat";
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Stat
          label="Position"
          value={`${side} ${grouped(Math.abs(trader.base_lots))}`}
        />
        <Stat label="Collateral" value={money(trader.collateral)} />
        <Stat label="Free" value={money(trader.free_collateral)} />
        <Stat label="Marks balance" value={money(trader.unallocated)} />
        <Stat label="Debt" value={money(trader.debt ?? "0")} />
        <Stat
          label="Liquidation"
          value={
            trader.liquidation_quote_per_lot
              ? money(trader.liquidation_quote_per_lot)
              : "None"
          }
        />
      </dl>
      {trader.base_lots !== 0 && trader.liquidation_quote_per_lot ? (
        <p className="text-xs text-muted-foreground">
          The position closes if the price reaches{" "}
          {money(trader.liquidation_quote_per_lot)}.
        </p>
      ) : null}
      {trader.gift_id !== null && trader.gift_id !== undefined ? (
        <p className="text-xs text-gold">
          This position is held for gift {trader.gift_id} until it is claimed or
          refunded.
        </p>
      ) : null}
      <Link
        className="btn-line w-full text-sm"
        href={`/borrow?symbol=${symbol}`}
      >
        Borrow against this position, up to {money(trader.borrow_limit ?? "0")}
      </Link>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          const atoms = atomsFromDollars(amount);
          if (atoms === null || atoms === BigInt(0)) {
            toast.error("Enter the USDC to commit, such as 100.");
            return;
          }
          setBusy(true);
          void commitMargin(send, symbol, atoms)
            .then(() => toast.success("Committed."))
            .catch((caught) =>
              toast.error(
                caught instanceof Error ? caught.message : "Commit failed",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <label htmlFor={id} className="text-sm text-muted-foreground">
          Commit USDC from your Marks balance to this market
        </label>
        <input
          id={id}
          className={control}
          inputMode="decimal"
          autoComplete="off"
          placeholder="100"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
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
  const toast = useToast();
  const [orderId, setOrderId] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  return (
    <div className="space-y-4">
      {!trader ? (
        <Spinner />
      ) : (
        <p className="text-sm text-muted-foreground">
          Open bids {grouped(trader.open_bid_lots)}. Open asks{" "}
          {grouped(trader.open_ask_lots)}.
        </p>
      )}
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!/^\d+$/.test(orderId)) {
            toast.error("Enter the order id.");
            return;
          }
          setBusy(true);
          void cancelOrder(send, symbol, Number(orderId))
            .then(() => toast.success("Cancelled."))
            .catch((caught) =>
              toast.error(
                caught instanceof Error ? caught.message : "Cancel failed",
              ),
            )
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
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-mono">{value}</dd>
    </div>
  );
}
