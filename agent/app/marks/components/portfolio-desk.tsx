import { BalanceStrip, Stat, Spinner } from "@/marks/components/v2-ui";
import { grouped, money } from "@/marks/lib/format";
import { useNear } from "@/marks/lib/near";
import type { Market, Trader } from "@/marks/lib/rpc";
import { useWallet, useOnTraded } from "@/marks/lib/use-v2";
import {
  seriesTitle,
  shareTicker,
  units,
  valueOf,
  viewMarks,
  type Gift,
  type OptionPosition,
  type Series,
  type Share,
} from "@/marks/lib/v2";
import Link from "@/marks/components/link";
import { useEffect, useState, useCallback } from "react";

const ZERO = BigInt(0);

type Book = {
  perps: { market: Market; trader: Trader }[];
  calls: { series: Series; position: OptionPosition }[];
  sent: Gift[];
  received: Gift[];
};

export function PortfolioDesk({
  markets,
  shares,
  series,
}: {
  markets: Market[];
  shares: Share[];
  series: Series[];
}) {
  const { account, network, openDialog } = useNear();
  const { wallet, loading } = useWallet();
  const [book, setBook] = useState<Book | null>(null);
  const [tick, setTick] = useState(0);
  useOnTraded(useCallback(() => setTick((value) => value + 1), []));

  useEffect(() => {
    if (!account) {
      setBook(null);
      return;
    }
    let cancelled = false;
    void Promise.all([
      Promise.all(
        markets.map((market) =>
          viewMarks<Trader>(network, "get_trader", {
            symbol: market.symbol,
            account_id: account,
          })
            .then((trader) => ({ market, trader }))
            .catch(() => null),
        ),
      ),
      Promise.all(
        series.map((item) =>
          viewMarks<OptionPosition>(network, "get_option_position", {
            series_id: item.id,
            account_id: account,
          })
            .then((position) => ({ series: item, position }))
            .catch(() => null),
        ),
      ),
      viewMarks<Gift[]>(network, "get_gifts_sent", {
        account_id: account,
      }).catch(() => [] as Gift[]),
      viewMarks<Gift[]>(network, "get_gifts_received", {
        account_id: account,
      }).catch(() => [] as Gift[]),
    ]).then(([perps, calls, sent, received]) => {
      if (cancelled) return;
      setBook({
        perps: perps.filter(
          (row): row is NonNullable<typeof row> =>
            row !== null &&
            (row.trader.base_lots !== 0 ||
              BigInt(row.trader.collateral) > ZERO ||
              BigInt(row.trader.debt ?? "0") > ZERO),
        ),
        calls: calls.filter(
          (row): row is NonNullable<typeof row> =>
            row !== null && (row.position.long > 0 || row.position.short > 0),
        ),
        sent,
        received,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [account, network, markets, series, tick]);

  if (!account) {
    return (
      <div className="panel space-y-3 p-6">
        <p>
          Sign in to see your positions, shares, loans, calls and gifts in one
          place.
        </p>
        <button type="button" className="btn-gold" onClick={openDialog}>
          Sign in
        </button>
      </div>
    );
  }

  const holdings = shares
    .map((share) => ({
      share,
      free: BigInt(wallet.holdings[share.asset_id] ?? "0"),
      locked: BigInt(wallet.loans[share.asset_id]?.units ?? "0"),
      debt: BigInt(wallet.loans[share.asset_id]?.debt ?? "0"),
    }))
    .filter((row) => row.free > ZERO || row.locked > ZERO);
  const shareValue = holdings.reduce(
    (sum, row) => sum + valueOf(row.free + row.locked, BigInt(row.share.price)),
    ZERO,
  );
  const perpEquity = (book?.perps ?? []).reduce(
    (sum, row) => sum + BigInt(row.trader.equity ?? row.trader.collateral),
    ZERO,
  );
  const debt =
    holdings.reduce((sum, row) => sum + row.debt, ZERO) +
    (book?.perps ?? []).reduce(
      (sum, row) => sum + BigInt(row.trader.debt ?? "0"),
      ZERO,
    );
  const total =
    BigInt(wallet.usdc) + BigInt(wallet.balance) + shareValue + perpEquity;

  return (
    <div className="space-y-6">
      <BalanceStrip wallet={wallet} loading={loading} />
      <div className="panel grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Everything, in USDC"
          value={money(total)}
          hint="Wallet, Marks balance, shares and perp equity"
        />
        <Stat
          label="Shares"
          value={money(shareValue)}
          hint={`${holdings.length} assets`}
        />
        <Stat
          label="Perp equity"
          value={money(perpEquity)}
          hint={`${book?.perps.length ?? 0} markets`}
        />
        <Stat
          label="Owed to the pool"
          value={money(debt)}
          hint="Perp and share loans"
        />
      </div>

      <Section
        title="Perp positions"
        empty="No perp positions."
        link={["/markets", "Open the desk"]}
        rows={book?.perps.length ?? null}
      >
        {book?.perps.map(({ market, trader }) => (
          <tr
            key={market.symbol}
            className="border-b border-line last:border-0"
          >
            <td className="px-4 py-3">
              <Link
                className="font-semibold hover:text-gold"
                href={`/markets/${market.symbol}`}
              >
                {market.symbol}
              </Link>
              {trader.gift_id !== null && trader.gift_id !== undefined ? (
                <span className="ml-2 text-xs text-gold">
                  in gift {trader.gift_id}
                </span>
              ) : null}
            </td>
            <td className="px-4 py-3 font-mono">
              {trader.base_lots > 0
                ? "Long"
                : trader.base_lots < 0
                  ? "Short"
                  : "Flat"}{" "}
              {grouped(Math.abs(trader.base_lots))}
            </td>
            <td className="px-4 py-3 font-mono">
              {money(trader.equity ?? trader.collateral)}
            </td>
            <td className="px-4 py-3 font-mono">
              {money(trader.unrealized_pnl ?? "0")}
            </td>
            <td className="px-4 py-3 font-mono">{money(trader.debt ?? "0")}</td>
            <td className="px-4 py-3 font-mono">
              {trader.liquidation_quote_per_lot
                ? money(trader.liquidation_quote_per_lot)
                : "None"}
            </td>
          </tr>
        ))}
      </Section>

      <Section
        title="Shares"
        empty="No shares."
        link={["/stocks", "Buy shares"]}
        rows={holdings.length}
        head={["Asset", "Free", "Locked", "Value", "Loan", ""]}
      >
        {holdings.map(({ share, free, locked, debt: owed }) => (
          <tr
            key={share.asset_id}
            className="border-b border-line last:border-0"
          >
            <td className="px-4 py-3 font-semibold">
              {shareTicker(share.asset_id)}
            </td>
            <td className="px-4 py-3 font-mono">{units(free)}</td>
            <td className="px-4 py-3 font-mono">{units(locked)}</td>
            <td className="px-4 py-3 font-mono">
              {money(valueOf(free + locked, BigInt(share.price)))}
            </td>
            <td className="px-4 py-3 font-mono">{money(owed)}</td>
            <td className="px-4 py-3">
              <Link
                className="text-sm text-gold hover:underline"
                href={`/borrow?asset=${share.asset_id}`}
              >
                Borrow
              </Link>
            </td>
          </tr>
        ))}
      </Section>

      <Section
        title="Capped calls"
        empty="No calls."
        link={["/stocks", "Pick a call"]}
        rows={book?.calls.length ?? null}
        head={["Series", "Long", "Short", "Status", "", ""]}
      >
        {book?.calls.map(({ series: item, position }) => (
          <tr key={item.id} className="border-b border-line last:border-0">
            <td className="px-4 py-3">{seriesTitle(item)}</td>
            <td className="px-4 py-3 font-mono">{position.long}</td>
            <td className="px-4 py-3 font-mono">{position.short}</td>
            <td className="px-4 py-3">
              {item.settle_price
                ? `Settled at ${money(item.settle_price)}`
                : "Open"}
            </td>
            <td />
            <td />
          </tr>
        ))}
      </Section>

      <div className="panel flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="label-mono">Gifts</p>
          {book ? (
            <p className="mt-1">
              {book.sent.length} sent · {book.received.length} opened by you
            </p>
          ) : (
            <Spinner />
          )}
        </div>
        <Link className="btn-line text-sm" href="/send">
          Send or manage gifts
        </Link>
      </div>
    </div>
  );
}

function Section({
  title,
  empty,
  link,
  rows,
  head = ["Market", "Position", "Equity", "Open profit", "Debt", "Liquidation"],
  children,
}: {
  title: string;
  empty: string;
  link: [string, string];
  rows: number | null;
  head?: string[];
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        <Link className="text-sm text-gold hover:underline" href={link[0]}>
          {link[1]}
        </Link>
      </header>
      {rows === null ? (
        <Spinner />
      ) : rows === 0 ? (
        <p className="p-4 text-sm text-ink-muted">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="label-mono border-b border-line">
              <tr>
                {head.map((cell, index) => (
                  <th key={index} className="px-4 py-2 font-normal">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
