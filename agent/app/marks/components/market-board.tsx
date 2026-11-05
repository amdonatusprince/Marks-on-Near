import Link from "@/marks/components/link";
import {
  fundingWords,
  grouped,
  money,
  openInterest,
  price,
} from "@/marks/lib/format";
import { contractSize } from "@/marks/lib/markets";
import type { Network } from "@/marks/lib/network";
import { view, type Market } from "@/marks/lib/rpc";

/** Each market's funding rate in basis points, or null where the read failed. */
export function fundingRates(network: Network, markets: Market[]) {
  return Promise.all(
    markets.map((market) =>
      view<number>(network, "get_funding_rate_bps", {
        symbol: market.symbol,
      }).catch(() => null),
    ),
  );
}

/** Every perp as a table from 768px and as cards below it. */
export function MarketBoard({
  markets,
  rates,
}: {
  markets: Market[];
  rates: (number | null)[];
}) {
  return (
    <>
      <ul className="grid gap-3 md:hidden">
        {markets.map((market, index) => (
          <li key={market.symbol}>
            <Link
              href={`/markets/${market.symbol}`}
              className="panel flex items-center justify-between gap-4 p-4 hover:border-gold"
            >
              <span className="min-w-0">
                <span className="block font-semibold">{market.symbol}</span>
                <span className="label-mono block truncate">
                  {contractSize(market.symbol)}
                </span>
              </span>
              <span className="text-right">
                <span className="block font-mono">
                  {price(market.mark_ticks, market.tick_size)}
                </span>
                <span className="block text-xs text-ink-muted">
                  {rates[index] === null
                    ? "\u2014"
                    : fundingWords(rates[index] ?? 0)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="panel hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="label-mono border-b border-line">
            <tr>
              <th className="px-4 py-3 font-normal">Market</th>
              <th className="px-4 py-3 font-normal">Price</th>
              <th className="px-4 py-3 font-normal">Funding</th>
              <th className="px-4 py-3 font-normal">Open interest</th>
              <th className="px-4 py-3 font-normal">Traded</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((market, index) => (
              <tr
                key={market.symbol}
                className="border-b border-line last:border-0"
              >
                <td className="px-4 py-4">
                  <Link
                    href={`/markets/${market.symbol}`}
                    className="font-semibold underline-offset-4 hover:text-gold hover:underline"
                  >
                    {market.symbol}
                  </Link>
                  <span className="mt-1 block text-xs text-ink-muted">
                    {contractSize(market.symbol)} · {market.category}
                  </span>
                </td>
                <td className="px-4 py-4 font-mono">
                  {price(market.mark_ticks, market.tick_size)}
                </td>
                <td className="px-4 py-4">
                  {rates[index] === null
                    ? "\u2014"
                    : fundingWords(rates[index] ?? 0)}
                </td>
                <td className="px-4 py-4">
                  <span className="font-mono">
                    {openInterest(
                      market.open_interest_lots,
                      market.mark_ticks,
                      market.tick_size,
                    )}
                  </span>
                  <span className="mt-1 block text-xs text-ink-muted">
                    {grouped(market.open_interest_lots)}{" "}
                    {market.open_interest_lots === 1 ? "contract" : "contracts"}
                  </span>
                </td>
                <td className="px-4 py-4 font-mono">
                  {money(market.volume_quote)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel max-w-prose space-y-2 p-6">
      <h1 className="font-display text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-ink-muted">{body}</p>
    </div>
  );
}

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="stage-light mx-auto w-full max-w-[1440px] flex-1 px-4 py-8 md:px-6 md:py-10">
      {children}
    </div>
  );
}

export function PageHead({
  label,
  title,
  italic,
  lede,
}: {
  label?: string;
  title: string;
  italic?: string;
  lede?: string;
}) {
  return (
    <header className="mb-8">
      {label ? <p className="label-mono">{label}</p> : null}
      <h1
        className={`display text-[clamp(2.4rem,6vw,4.5rem)]${label ? " mt-3" : ""}`}
      >
        {title}{" "}
        {italic ? <span className="display-italic">{italic}</span> : null}
      </h1>
      {lede ? (
        <p className="mt-4 max-w-[60ch] text-base text-ink-muted md:text-lg">
          {lede}
        </p>
      ) : null}
    </header>
  );
}
