"use client";

import { BalanceStrip, Row, Tabs, TxNote } from "@/components/v2-ui";
import { atomsFromDollars, grouped, money } from "@/lib/format";
import { HEAVY_GAS, ORACLE_FEE, useNear } from "@/lib/near";
import { useAction, useClock, useWallet } from "@/lib/use-v2";
import {
  UNIT,
  dollarsShort,
  expiryDate,
  isFresh,
  shareSize,
  shareTicker,
  shortDate,
  units,
  unitsFromText,
  valueOf,
  viewMarks,
  type OptionBook,
  type OptionPosition,
  type Series,
  type Share,
} from "@/lib/v2";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";

type Mode = "buy" | "sell" | "calls";

export function StocksDesk({ shares, series }: { shares: Share[]; series: Series[] }) {
  const [selected, setSelected] = useState(shares[0]?.asset_id ?? "");
  const [mode, setMode] = useState<Mode>("buy");
  const { wallet, loading, refresh } = useWallet();
  const router = useRouter();
  const share = shares.find((item) => item.asset_id === selected);
  const after = () => {
    refresh();
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <BalanceStrip wallet={wallet} loading={loading} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <ul
          className="grid content-start gap-3 self-start sm:grid-cols-2 xl:grid-cols-3"
          aria-label="Shares"
        >
          {shares.map((item) => {
            const held = wallet.holdings[item.asset_id];
            const active = item.asset_id === selected;
            return (
              <li key={item.asset_id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelected(item.asset_id)}
                  className={`panel w-full p-4 text-left transition-colors ${
                    active ? "border-gold" : "hover:border-ink-muted"
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-display text-2xl font-semibold">
                      {shareTicker(item.asset_id)}
                    </span>
                    <span className="font-mono text-lg">{money(item.price)}</span>
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-3 text-xs text-ink-muted">
                    <span className="truncate">
                      {item.name} · {shareSize(item.asset_id)}
                    </span>
                    <Freshness share={item} />
                  </span>
                  {held ? (
                    <span className="mt-3 block text-sm">
                      You hold <span className="font-mono">{units(held)}</span>, worth{" "}
                      <span className="font-mono">
                        {money(valueOf(BigInt(held), BigInt(item.price)))}
                      </span>
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        {share ? (
          <aside className="panel h-fit space-y-5 p-5 lg:sticky lg:top-24">
            <header>
              <p className="label-mono">{share.name}</p>
              <p className="mt-1 font-display text-4xl font-semibold">{money(share.price)}</p>
              <p className="text-xs text-ink-muted">
                per {shareSize(share.asset_id)} · <Updated ns={share.updated_ns} />
              </p>
            </header>
            <Tabs
              label="Action"
              value={mode}
              onChange={setMode}
              options={[
                ["buy", "Buy"],
                ["sell", "Sell"],
                ["calls", "Calls"],
              ]}
            />
            {mode === "buy" ? (
              <BuyShares
                key={share.asset_id}
                share={share}
                balance={wallet.balance}
                onDone={after}
              />
            ) : mode === "sell" ? (
              <SellShares
                key={share.asset_id}
                share={share}
                held={wallet.holdings[share.asset_id] ?? "0"}
                onDone={after}
              />
            ) : (
              <Calls
                key={share.asset_id}
                share={share}
                series={series.filter((item) => item.asset_id === share.asset_id)}
                onDone={after}
              />
            )}
            {mode !== "calls" ? (
              <Link
                href={`/borrow?asset=${share.asset_id}`}
                className="gold-link block text-sm text-gold underline-offset-4 hover:underline"
              >
                Borrow against your {shareTicker(share.asset_id)} without selling it
              </Link>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function Updated({ ns }: { ns: number }) {
  const now = useClock();
  if (!ns) return <>never updated</>;
  return <>updated {now === null ? "" : new Date(ns / 1_000_000).toLocaleTimeString()}</>;
}

function Freshness({ share }: { share: Share }) {
  const now = useClock();
  if (now === null) return <span className="shrink-0 font-mono text-ink-muted">…</span>;
  const fresh = isFresh(share, now);
  return (
    <span className={`shrink-0 font-mono ${fresh ? "text-ok" : "text-pending"}`}>
      {fresh ? "LIVE" : "STALE"}
    </span>
  );
}

export function RefreshPrice({ share, onDone }: { share: Share; onDone: () => void }) {
  const { send } = useNear();
  const { busy, hash, error, pulse, run } = useAction();
  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      <p className="text-sm text-ink-muted">
        Buying needs a price from the last hour. A refresh asks the oracle for a new print and costs
        0.02 NEAR.
      </p>
      <button
        type="button"
        className="btn-line w-full text-sm"
        disabled={Boolean(busy)}
        onClick={() =>
          void run("refresh", () =>
            send(
              "refresh_share",
              { asset_id: share.asset_id },
              { deposit: ORACLE_FEE, gas: HEAVY_GAS },
            ),
          ).then((next) => {
            if (next !== null) onDone();
          })
        }
      >
        {busy ? "Asking the oracle" : "Refresh the price"}
      </button>
      <TxNote hash={hash} error={error} pulse={pulse} done="Price refreshed." />
    </div>
  );
}

function BuyShares({
  share,
  balance,
  onDone,
}: {
  share: Share;
  balance: string;
  onDone: () => void;
}) {
  const { account, openDialog, send } = useNear();
  const [amount, setAmount] = useState("");
  const { busy, hash, error, pulse, run, setError } = useAction();
  const id = useId();
  const atoms = atomsFromDollars(amount);
  const price = BigInt(share.price);
  const estimate = atoms && price > BigInt(0) ? (atoms * UNIT) / price : BigInt(0);
  const now = useClock();
  if (now !== null && !isFresh(share, now)) return <RefreshPrice share={share} onDone={onDone} />;
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!account) return openDialog();
        if (!atoms || estimate === BigInt(0))
          return setError("Enter the USDC to spend, such as 25.");
        if (atoms > BigInt(balance)) {
          return setError("That is more than your Marks balance. Deposit from the faucet page.");
        }
        void run("buy", () =>
          send("buy_shares", { asset_id: share.asset_id, amount: atoms.toString() }),
        ).then((next) => {
          if (next !== null) {
            setAmount("");
            onDone();
          }
        });
      }}
    >
      <label htmlFor={id} className="label-mono block">
        Spend USDC
      </label>
      <input
        id={id}
        className="field font-mono"
        inputMode="decimal"
        autoComplete="off"
        placeholder="25"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <dl>
        <Row label="You receive" value={`${units(estimate)} ${shareTicker(share.asset_id)}`} />
        <Row label="Price" value={money(share.price)} />
        <Row label="Marks balance" value={money(balance)} />
      </dl>
      <button type="submit" className="btn-gold w-full" disabled={Boolean(busy)}>
        {busy ? "Buying" : account ? `Buy ${shareTicker(share.asset_id)}` : "Sign in to buy"}
      </button>
      <TxNote hash={hash} error={error} pulse={pulse} done="Bought." />
    </form>
  );
}

function SellShares({ share, held, onDone }: { share: Share; held: string; onDone: () => void }) {
  const { account, openDialog, send } = useNear();
  const [amount, setAmount] = useState("");
  const { busy, hash, error, pulse, run, setError } = useAction();
  const id = useId();
  const count = unitsFromText(amount);
  const proceeds = count ? valueOf(count, BigInt(share.price)) : BigInt(0);
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!account) return openDialog();
        if (!count || count === BigInt(0)) return setError("Enter the shares to sell.");
        if (count > BigInt(held)) return setError("You hold fewer shares than that.");
        void run("sell", () =>
          send("sell_shares", { asset_id: share.asset_id, units: count.toString() }),
        ).then((next) => {
          if (next !== null) {
            setAmount("");
            onDone();
          }
        });
      }}
    >
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="label-mono">
          Shares to sell
        </label>
        <button
          type="button"
          className="text-xs text-gold underline-offset-4 hover:underline"
          onClick={() => setAmount(units(held, 6))}
        >
          All {units(held)}
        </button>
      </div>
      <input
        id={id}
        className="field font-mono"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.5"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <dl>
        <Row label="You receive" value={money(proceeds)} />
        <Row label="You hold" value={units(held)} />
      </dl>
      <button type="submit" className="btn-gold w-full" disabled={Boolean(busy)}>
        {busy ? "Selling" : account ? `Sell ${shareTicker(share.asset_id)}` : "Sign in to sell"}
      </button>
      <TxNote
        hash={hash}
        error={error}
        pulse={pulse}
        done="Sold. The proceeds are in your Marks balance."
      />
    </form>
  );
}

function Calls({ share, series, onDone }: { share: Share; series: Series[]; onDone: () => void }) {
  const [picked, setPicked] = useState(series[0]?.id ?? "");
  const chosen = series.find((item) => item.id === picked);
  if (series.length === 0) {
    return <p className="text-sm text-ink-muted">No call series are listed on this asset yet.</p>;
  }
  return (
    <div className="space-y-4">
      <ul className="grid gap-2" aria-label="Series">
        {series.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              aria-pressed={item.id === picked}
              onClick={() => setPicked(item.id)}
              className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${
                item.id === picked ? "border-gold" : "border-line hover:border-ink-muted"
              }`}
            >
              <span className="flex justify-between gap-2">
                <span className="font-semibold">
                  {dollarsShort(item.strike)} to {dollarsShort(item.cap)}
                </span>
                <span className="font-mono">
                  {item.settle_price
                    ? "settled"
                    : `ask ${item.best_ask ? money(item.best_ask) : "none"}`}
                </span>
              </span>
              <span className="mt-1 block text-xs text-ink-muted">
                Expires {shortDate(item.expiry_ns)} · {item.open_interest} open
              </span>
            </button>
          </li>
        ))}
      </ul>
      {chosen ? <CallTicket key={chosen.id} share={share} series={chosen} onDone={onDone} /> : null}
    </div>
  );
}

function CallTicket({
  share,
  series,
  onDone,
}: {
  share: Share;
  series: Series;
  onDone: () => void;
}) {
  const { account, network, openDialog, send } = useNear();
  const [side, setSide] = useState<"bid" | "ask">("bid");
  const [premium, setPremium] = useState(
    series.best_ask ? (Number(series.best_ask) / 1e6).toFixed(2) : "",
  );
  const [lots, setLots] = useState("1");
  const [book, setBook] = useState<OptionBook | null>(null);
  const [position, setPosition] = useState<OptionPosition | null>(null);
  const { busy, hash, error, pulse, run, setError } = useAction();
  const premiumId = useId();
  const lotsId = useId();

  useEffect(() => {
    let cancelled = false;
    void viewMarks<OptionBook>(network, "get_option_book", { series_id: series.id, depth: 5 })
      .then((next) => !cancelled && setBook(next))
      .catch(() => undefined);
    if (account) {
      void viewMarks<OptionPosition>(network, "get_option_position", {
        series_id: series.id,
        account_id: account,
      })
        .then((next) => !cancelled && setPosition(next))
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [account, network, series.id, hash]);

  const strike = BigInt(series.strike);
  const width = BigInt(series.cap) - strike;
  const perPremium = atomsFromDollars(premium) ?? BigInt(0);
  const count = /^\d+$/.test(lots) ? BigInt(lots) : BigInt(0);
  const now = useClock();
  const expired = now !== null && expiryDate(series.expiry_ns).getTime() <= now;
  const math = useMemo(
    () =>
      side === "bid"
        ? {
            pay: perPremium * count,
            breakEven: strike + perPremium,
            loss: perPremium * count,
            gain: (width - perPremium) * count,
          }
        : {
            pay: width * count,
            breakEven: strike + perPremium,
            loss: (width - perPremium) * count,
            gain: perPremium * count,
          },
    [side, perPremium, count, strike, width],
  );

  if (series.settle_price || expired) {
    return (
      <Settlement
        series={series}
        position={position}
        onDone={onDone}
        sharePrice={share.price}
        busy={busy}
        hash={hash}
        error={error}
        pulse={pulse}
        run={run}
      />
    );
  }

  return (
    <form
      className="space-y-3 border-t border-line pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!account) return openDialog();
        if (perPremium === BigInt(0) || perPremium > width) {
          return setError(`Enter a premium between $0.01 and ${dollarsShort(width)}.`);
        }
        if (count === BigInt(0)) return setError("Enter how many contracts.");
        void run("place", () =>
          send("place_option", {
            series_id: series.id,
            side,
            premium: perPremium.toString(),
            lots: Number(count),
          }),
        ).then((next) => {
          if (next !== null) onDone();
        });
      }}
    >
      <Tabs
        label="Side"
        value={side}
        onChange={setSide}
        options={[
          ["bid", "Buy calls"],
          ["ask", "Write calls"],
        ]}
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={premiumId} className="label-mono block">
            Premium each
          </label>
          <input
            id={premiumId}
            className="field mt-1 font-mono"
            inputMode="decimal"
            autoComplete="off"
            value={premium}
            onChange={(event) => setPremium(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor={lotsId} className="label-mono block">
            Contracts
          </label>
          <input
            id={lotsId}
            className="field mt-1 font-mono"
            inputMode="numeric"
            autoComplete="off"
            value={lots}
            onChange={(event) => setLots(event.target.value)}
          />
        </div>
      </div>
      {book ? (
        <p className="text-xs text-ink-muted">
          Best bid{" "}
          {book.bids[0] ? `${money(book.bids[0].premium)} × ${grouped(book.bids[0].lots)}` : "none"}{" "}
          · best ask{" "}
          {book.asks[0] ? `${money(book.asks[0].premium)} × ${grouped(book.asks[0].lots)}` : "none"}
        </p>
      ) : null}
      <dl className="rounded-lg border border-line px-3 py-2">
        <Row
          label="Expiry"
          value={now === null ? "" : expiryDate(series.expiry_ns).toLocaleString()}
        />
        <Row
          label="Pays per contract"
          value={`price − ${dollarsShort(strike)}, up to ${dollarsShort(width)}`}
        />
        <Row label="Break-even at expiry" value={money(math.breakEven)} />
        <Row
          label={side === "bid" ? "You pay now" : "You lock now"}
          value={money(math.pay)}
          strong
        />
        <Row label="Most you can lose" value={money(math.loss)} />
        <Row label="Most you can make" value={money(math.gain)} />
      </dl>
      <p className="text-xs text-ink-muted">
        {side === "bid"
          ? "Fully paid. No margin and no liquidation: the premium is the whole risk."
          : `Writing locks ${dollarsShort(width)} per contract until expiry and earns the premium.`}
      </p>
      {position && (position.long > 0 || position.short > 0) ? (
        <p className="text-sm">
          You hold {position.long} long and {position.short} short in this series.
        </p>
      ) : null}
      <button type="submit" className="btn-gold w-full" disabled={Boolean(busy)}>
        {busy
          ? "Placing"
          : !account
            ? "Sign in to trade calls"
            : side === "bid"
              ? `Buy ${grouped(lots || 0)} for ${money(math.pay)}`
              : `Write ${grouped(lots || 0)}, lock ${money(math.pay)}`}
      </button>
      <TxNote
        hash={hash}
        error={error}
        pulse={pulse}
        done="Placed. A crossing order fills at once; the rest rests on the book."
      />
    </form>
  );
}

function Settlement({
  series,
  position,
  sharePrice,
  onDone,
  busy,
  hash,
  error,
  pulse,
  run,
}: {
  series: Series;
  position: OptionPosition | null;
  sharePrice: string;
  onDone: () => void;
  busy: string;
  hash: string;
  error: string;
  pulse: number;
  run: (label: string, action: () => Promise<string>) => Promise<string | null>;
}) {
  const { account, send } = useNear();
  const strike = BigInt(series.strike);
  const width = BigInt(series.cap) - strike;
  const settle = series.settle_price ? BigInt(series.settle_price) : null;
  const payout =
    settle === null
      ? null
      : settle > strike
        ? settle - strike < width
          ? settle - strike
          : width
        : BigInt(0);
  const holds = position && (position.long > 0 || position.short > 0);
  return (
    <div className="space-y-3 border-t border-line pt-4">
      <dl>
        <Row label="Expired" value={expiryDate(series.expiry_ns).toLocaleString()} />
        <Row label="Settled at" value={settle === null ? "waiting" : money(settle)} />
        <Row
          label="Pays per contract"
          value={payout === null ? "after settlement" : money(payout)}
          strong
        />
        <Row label="Share now" value={money(sharePrice)} />
      </dl>
      {settle === null ? (
        <button
          type="button"
          className="btn-line w-full"
          disabled={Boolean(busy)}
          onClick={() =>
            void run("settle", () =>
              send("settle_series", { series_id: series.id }, { gas: "100000000000000" }),
            ).then((next) => next !== null && onDone())
          }
        >
          {busy ? "Settling" : "Settle with the first print after expiry"}
        </button>
      ) : account && holds ? (
        <button
          type="button"
          className="btn-gold w-full"
          disabled={Boolean(busy)}
          onClick={() =>
            void run("claim", () => send("claim_settlement", { series_id: series.id })).then(
              (next) => next !== null && onDone(),
            )
          }
        >
          {busy ? "Claiming" : "Claim to my Marks balance"}
        </button>
      ) : null}
      <TxNote hash={hash} error={error} pulse={pulse} />
    </div>
  );
}
