import { RefreshPrice } from "@/marks/components/stocks-desk";
import {
  BalanceStrip,
  Row,
  Stat,
  Tabs,
  TxNote,
} from "@/marks/components/v2-ui";
import {
  atomsFromDollars,
  grouped,
  liquidationPrice,
  money,
} from "@/marks/lib/format";
import {
  borrowAgainstShares,
  borrowOnPosition,
  repayShareLoan,
} from "@/marks/lib/desk-writes";
import { useNear } from "@/marks/lib/near";
import type { Market, Trader } from "@/marks/lib/rpc";
import {
  useAction,
  useClock,
  useOnTraded,
  useWallet,
} from "@/marks/lib/use-v2";
import {
  SHARE_LIQUIDATION_BPS,
  SHARE_LTV_BPS,
  UNIT,
  fee,
  isFresh,
  shareTicker,
  units,
  unitsFromText,
  valueOf,
  viewMarks,
  type Pool,
  type Share,
  type ShareLoan,
} from "@/marks/lib/v2";
import Link from "@/marks/components/link";
import { useRouter } from "@/marks/lib/navigation";
import { useCallback, useEffect, useId, useState } from "react";

const ZERO = BigInt(0);
const BPS = BigInt(10_000);

export function BorrowDesk({
  markets,
  shares,
  pool,
  initialSymbol,
  initialAsset,
}: {
  markets: Market[];
  shares: Share[];
  pool: Pool;
  initialSymbol?: string | undefined;
  initialAsset?: string | undefined;
}) {
  const [mode, setMode] = useState<"perp" | "shares">(
    initialAsset ? "shares" : "perp",
  );
  const { wallet, loading, refresh } = useWallet();
  const router = useRouter();
  const after = () => {
    refresh();
    router.refresh();
  };
  return (
    <div className="space-y-6">
      <BalanceStrip wallet={wallet} loading={loading} />
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="panel h-fit space-y-4 p-5">
          <p className="label-mono">The lending pool</p>
          <Stat label="Available to lend" value={money(pool.cash)} />
          <Stat label="Out on loan" value={money(pool.lent)} />
          <Stat label="Fees earned" value={money(pool.fees)} />
          <p className="text-xs text-ink-muted">
            Marks funds the pool. Each loan costs 1 percent once, added to the
            debt. Borrowed USDC lands in your Marks balance, where you can
            trade, buy, gift or withdraw it.
          </p>
        </aside>
        <section className="space-y-5">
          <Tabs
            label="Collateral"
            value={mode}
            onChange={setMode}
            options={[
              ["perp", "Against a perp"],
              ["shares", "Against shares"],
            ]}
          />
          {mode === "perp" ? (
            <PerpLoans
              markets={markets}
              initial={initialSymbol}
              balance={wallet.balance}
              onDone={after}
            />
          ) : (
            <ShareLoans
              shares={shares}
              holdings={wallet.holdings}
              loans={wallet.loans}
              initial={initialAsset}
              balance={wallet.balance}
              onDone={after}
            />
          )}
        </section>
      </div>
    </div>
  );
}

type Held = { market: Market; trader: Trader };

function PerpLoans({
  markets,
  initial,
  balance,
  onDone,
}: {
  markets: Market[];
  initial?: string | undefined;
  balance: string;
  onDone: () => void;
}) {
  const { account, network, openDialog } = useNear();
  const [held, setHeld] = useState<Held[] | null>(null);
  const [picked, setPicked] = useState(initial ?? "");
  const [tick, setTick] = useState(0);
  useOnTraded(useCallback(() => setTick((value) => value + 1), []));

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    void Promise.all(
      markets.map((market) =>
        viewMarks<Trader>(network, "get_trader", {
          symbol: market.symbol,
          account_id: account,
        })
          .then((trader) => ({ market, trader }))
          .catch(() => null),
      ),
    ).then((rows) => {
      if (cancelled) return;
      const open = rows.filter(
        (row): row is Held =>
          row !== null &&
          (row.trader.base_lots !== 0 || BigInt(row.trader.debt ?? "0") > ZERO),
      );
      setHeld(open);
      setPicked((current) =>
        open.some((row) => row.market.symbol === current)
          ? current
          : (open[0]?.market.symbol ?? ""),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [account, network, markets, tick]);

  if (!account) {
    return (
      <div className="panel p-5">
        <button type="button" className="btn-gold" onClick={openDialog}>
          Sign in to see your positions
        </button>
      </div>
    );
  }
  if (!held)
    return <p className="text-sm text-ink-muted">Reading your positions…</p>;
  if (held.length === 0) {
    return (
      <div className="panel space-y-3 p-5">
        <p>You have no open perp position to borrow against.</p>
        <Link href="/markets" className="btn-line text-sm">
          Open a position
        </Link>
      </div>
    );
  }
  const row = held.find((item) => item.market.symbol === picked) ?? held[0];
  if (!row) return null;
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <ul className="grid h-fit gap-2" aria-label="Your positions">
        {held.map(({ market, trader }) => (
          <li key={market.symbol}>
            <button
              type="button"
              aria-pressed={market.symbol === row.market.symbol}
              onClick={() => setPicked(market.symbol)}
              className={`panel w-full p-4 text-left ${market.symbol === row.market.symbol ? "border-gold" : "hover:border-ink-muted"}`}
            >
              <span className="flex justify-between gap-3">
                <span className="font-semibold">{market.symbol}</span>
                <span className="font-mono">
                  {trader.base_lots > 0
                    ? "Long"
                    : trader.base_lots < 0
                      ? "Short"
                      : "Flat"}{" "}
                  {grouped(Math.abs(trader.base_lots))}
                </span>
              </span>
              <span className="mt-1 flex justify-between gap-3 text-xs text-ink-muted">
                <span>Debt {money(trader.debt ?? "0")}</span>
                <span>Can borrow {money(trader.borrow_limit ?? "0")}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <PerpLoanTicket
        key={row.market.symbol}
        row={row}
        balance={balance}
        onDone={() => {
          setTick((value) => value + 1);
          onDone();
        }}
      />
    </div>
  );
}

function PerpLoanTicket({
  row,
  balance,
  onDone,
}: {
  row: Held;
  balance: string;
  onDone: () => void;
}) {
  const { send } = useNear();
  const { market, trader } = row;
  const [amount, setAmount] = useState("");
  const [repay, setRepay] = useState(false);
  const { busy, hash, error, pulse, run, setError } = useAction();
  const id = useId();
  const debt = BigInt(trader.debt ?? "0");
  const limit = BigInt(trader.borrow_limit ?? "0");
  const atoms = atomsFromDollars(amount) ?? ZERO;
  const charge = fee(atoms);
  const after = repay
    ? debt > atoms
      ? debt - atoms
      : ZERO
    : debt + atoms + charge;
  const liquidation = (owed: bigint) =>
    liquidationPrice(
      BigInt(trader.collateral) - owed,
      BigInt(trader.base_lots),
      BigInt(trader.entry_quote_per_lot ?? "0"),
      market.maintenance_margin_bps,
    );
  const now = liquidation(debt);
  const next = liquidation(after);
  const frozen = trader.gift_id !== null && trader.gift_id !== undefined;

  return (
    <form
      className="panel h-fit space-y-4 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (atoms === ZERO) return setError("Enter an amount in USDC.");
        if (!repay && atoms > limit) {
          return setError(
            `The most you can borrow on ${market.symbol} is ${money(limit)}.`,
          );
        }
        if (repay && atoms > BigInt(balance)) {
          return setError(
            "Your Marks balance is short. Deposit from the faucet page first.",
          );
        }
        void run(repay ? "repay" : "borrow", () =>
          borrowOnPosition(
            send,
            repay ? "repay" : "borrow",
            market.symbol,
            atoms,
          ),
        ).then((done) => {
          if (done !== null) {
            setAmount("");
            onDone();
          }
        });
      }}
    >
      <Tabs
        label="Loan action"
        value={repay ? "repay" : "borrow"}
        onChange={(value) => setRepay(value === "repay")}
        options={[
          ["borrow", "Borrow"],
          ["repay", "Repay"],
        ]}
      />
      {frozen ? (
        <p className="text-sm text-gold">
          This position is held for gift {trader.gift_id}. Borrowing opens again
          once it is claimed or refunded.
        </p>
      ) : null}
      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor={id} className="label-mono">
            {repay ? "Repay USDC" : "Borrow USDC"}
          </label>
          <button
            type="button"
            className="text-xs text-gold underline-offset-4 hover:underline"
            onClick={() =>
              setAmount((Number(repay ? debt : limit) / 1e6).toFixed(2))
            }
          >
            {repay ? `All ${money(debt)}` : `Max ${money(limit)}`}
          </button>
        </div>
        <input
          id={id}
          className="field mt-1 font-mono"
          inputMode="decimal"
          autoComplete="off"
          placeholder="100"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>
      <dl className="rounded-lg border border-line px-3 py-2">
        {!repay ? <Row label="Fee, 1 percent" value={money(charge)} /> : null}
        <Row label="Debt now" value={money(debt)} />
        <Row label="Debt after" value={money(after)} strong />
        <Row label="Liquidation now" value={now ? money(now) : "None"} />
        <Row
          label="Liquidation after"
          value={next ? money(next) : "None"}
          strong
        />
        <Row
          label="Mark"
          value={money(BigInt(market.mark_ticks) * BigInt(market.tick_size))}
        />
      </dl>
      <p className="text-xs text-ink-muted">
        The limit is your collateral plus half of any open profit, less losses,
        debt and the 10 percent initial margin. If the price reaches the
        liquidation level, the debt is repaid from collateral before anything
        else.
      </p>
      <button
        type="submit"
        className="btn-gold w-full"
        disabled={Boolean(busy) || (frozen && !repay)}
      >
        {busy
          ? "Sending"
          : repay
            ? `Repay ${money(atoms)}`
            : `Borrow ${money(atoms)}`}
      </button>
      <TxNote
        hash={hash}
        error={error}
        pulse={pulse}
        done={
          repay ? "Repaid." : "Borrowed. The USDC is in your Marks balance."
        }
      />
    </form>
  );
}

function ShareLoans({
  shares,
  holdings,
  loans,
  initial,
  balance,
  onDone,
}: {
  shares: Share[];
  holdings: Record<string, string>;
  loans: Record<string, ShareLoan>;
  initial?: string | undefined;
  balance: string;
  onDone: () => void;
}) {
  const { account, openDialog } = useNear();
  const owned = shares.filter(
    (share) =>
      BigInt(holdings[share.asset_id] ?? "0") > ZERO ||
      BigInt(loans[share.asset_id]?.units ?? "0") > ZERO,
  );
  const [picked, setPicked] = useState(initial ?? "");
  if (!account) {
    return (
      <div className="panel p-5">
        <button type="button" className="btn-gold" onClick={openDialog}>
          Sign in to see your shares
        </button>
      </div>
    );
  }
  if (owned.length === 0) {
    return (
      <div className="panel space-y-3 p-5">
        <p>You hold no shares to borrow against.</p>
        <Link href="/stocks" className="btn-line text-sm">
          Buy shares
        </Link>
      </div>
    );
  }
  const share = owned.find((item) => item.asset_id === picked) ?? owned[0];
  if (!share) return null;
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <ul className="grid h-fit gap-2" aria-label="Your shares">
        {owned.map((item) => {
          const loan = loans[item.asset_id];
          return (
            <li key={item.asset_id}>
              <button
                type="button"
                aria-pressed={item.asset_id === share.asset_id}
                onClick={() => setPicked(item.asset_id)}
                className={`panel w-full p-4 text-left ${item.asset_id === share.asset_id ? "border-gold" : "hover:border-ink-muted"}`}
              >
                <span className="flex justify-between gap-3">
                  <span className="font-semibold">
                    {shareTicker(item.asset_id)}
                  </span>
                  <span className="font-mono">{money(item.price)}</span>
                </span>
                <span className="mt-1 flex justify-between gap-3 text-xs text-ink-muted">
                  <span>
                    Free {units(holdings[item.asset_id] ?? "0")} · locked{" "}
                    {units(loan?.units ?? "0")}
                  </span>
                  <span>Debt {money(loan?.debt ?? "0")}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <ShareLoanTicket
        key={`${share.asset_id}-${holdings[share.asset_id] ?? "0"}`}
        share={share}
        free={holdings[share.asset_id] ?? "0"}
        loan={loans[share.asset_id] ?? { units: "0", debt: "0" }}
        balance={balance}
        onDone={onDone}
      />
    </div>
  );
}

function ShareLoanTicket({
  share,
  free,
  loan,
  balance,
  onDone,
}: {
  share: Share;
  free: string;
  loan: ShareLoan;
  balance: string;
  onDone: () => void;
}) {
  const { send } = useNear();
  const [repay, setRepay] = useState(false);
  const [lock, setLock] = useState(units(free, 6));
  const [amount, setAmount] = useState("");
  const { busy, hash, error, pulse, run, setError } = useAction();
  const lockId = useId();
  const amountId = useId();
  const price = BigInt(share.price);
  const debt = BigInt(loan.debt);
  const lockUnits = repay ? ZERO : (unitsFromText(lock) ?? ZERO);
  const lockedAfter = BigInt(loan.units) + lockUnits;
  const atoms = atomsFromDollars(amount) ?? ZERO;
  const value = valueOf(lockedAfter, price);
  const debtAfter = repay
    ? debt > atoms
      ? debt - atoms
      : ZERO
    : debt + atoms + fee(atoms);
  const room = (value * SHARE_LTV_BPS) / BPS;
  const max = room > debt ? ((room - debt) * BigInt(100)) / BigInt(101) : ZERO;
  const ltv = value > ZERO ? Number((debtAfter * BPS) / value) / 100 : 0;
  const liquidation =
    lockedAfter > ZERO && debtAfter > ZERO
      ? (debtAfter * BPS * UNIT) / (SHARE_LIQUIDATION_BPS * lockedAfter)
      : null;

  const now = useClock();
  if (!repay && now !== null && !isFresh(share, now))
    return <RefreshPrice share={share} onDone={onDone} />;
  return (
    <form
      className="panel h-fit space-y-4 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (repay) {
          if (atoms === ZERO) return setError("Enter an amount in USDC.");
          if (atoms > BigInt(balance)) {
            return setError(
              "Your Marks balance is short. Deposit from the faucet page first.",
            );
          }
        } else {
          if (lockUnits > BigInt(free))
            return setError("You hold fewer free shares than that.");
          if (atoms === ZERO) return setError("Enter an amount in USDC.");
          if (atoms > max)
            return setError(`The most you can borrow is ${money(max)}.`);
        }
        void run(repay ? "repay" : "borrow", () =>
          repay
            ? repayShareLoan(send, share.asset_id, atoms)
            : borrowAgainstShares(send, share.asset_id, lockUnits, atoms),
        ).then((done) => {
          if (done !== null) {
            setAmount("");
            onDone();
          }
        });
      }}
    >
      <Tabs
        label="Loan action"
        value={repay ? "repay" : "borrow"}
        onChange={(next) => setRepay(next === "repay")}
        options={[
          ["borrow", "Borrow"],
          ["repay", "Repay"],
        ]}
      />
      {!repay ? (
        <div>
          <label htmlFor={lockId} className="label-mono block">
            Shares to lock, of {units(free)} free
          </label>
          <input
            id={lockId}
            className="field mt-1 font-mono"
            inputMode="decimal"
            autoComplete="off"
            value={lock}
            onChange={(event) => setLock(event.target.value)}
          />
        </div>
      ) : null}
      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor={amountId} className="label-mono">
            {repay ? "Repay USDC" : "Borrow USDC"}
          </label>
          <button
            type="button"
            className="text-xs text-gold underline-offset-4 hover:underline"
            onClick={() =>
              setAmount((Number(repay ? debt : max) / 1e6).toFixed(2))
            }
          >
            {repay ? `All ${money(debt)}` : `Max ${money(max)}`}
          </button>
        </div>
        <input
          id={amountId}
          className="field mt-1 font-mono"
          inputMode="decimal"
          autoComplete="off"
          placeholder="50"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>
      <dl className="rounded-lg border border-line px-3 py-2">
        <Row
          label="Locked shares"
          value={`${units(lockedAfter)} ${shareTicker(share.asset_id)}`}
        />
        <Row label="Locked value" value={money(value)} />
        {!repay ? (
          <Row label="Fee, 1 percent" value={money(fee(atoms))} />
        ) : null}
        <Row label="Debt after" value={money(debtAfter)} strong />
        <Row label="Loan to value" value={`${ltv.toFixed(1)}% of 50% max`} />
        <Row
          label="Liquidation price"
          value={liquidation ? money(liquidation) : "None"}
          strong
        />
      </dl>
      <p className="text-xs text-ink-muted">
        Shares stay yours while locked. If the price falls until the debt passes
        65 percent of their value, anyone may sell them to the desk: the pool is
        repaid, the caller earns 1 percent and the rest returns to you. Repaying
        in full unlocks every share.
      </p>
      <button
        type="submit"
        className="btn-gold w-full"
        disabled={Boolean(busy)}
      >
        {busy
          ? "Sending"
          : repay
            ? `Repay ${money(atoms)}`
            : `Borrow ${money(atoms)}`}
      </button>
      <TxNote
        hash={hash}
        error={error}
        pulse={pulse}
        done={
          repay ? "Repaid." : "Borrowed. The USDC is in your Marks balance."
        }
      />
    </form>
  );
}
