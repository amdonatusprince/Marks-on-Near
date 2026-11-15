import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import Link from "@/marks/components/link";
import { TradeDesk } from "@/marks/components/trade-desk";
import {
  contractFor,
  oracleFor,
  type Network,
  SERVED_NETWORK,
} from "@/marks/lib/network";
import { chartCandles } from "@/marks/lib/ohlc";
import { view, viewAccount, type Book, type Market } from "@/marks/lib/rpc";
import { liveHeaders } from "@/marks/lib/page-load";
import { marksMeta } from "@/marks/lib/site-meta";

export const meta = ({ params }: { params: { symbol?: string } }) =>
  marksMeta(`Marks - ${params.symbol ?? "Market"}`);

export const headers = liveHeaders;

export async function loader({ params }: LoaderFunctionArgs) {
  const symbol = params.symbol ?? "";
  const network = SERVED_NETWORK;
  if (!contractFor(network)) {
    return {
      ok: false as const,
      symbol,
      message:
        network === "mainnet"
          ? "Marks lists its markets on testnet."
          : "Set VITE_CONTRACT_ID to the testnet account that holds Marks.",
    };
  }
  try {
    const market = await view<Market>(network, "get_market", { symbol });
    const book = await view<Book>(network, "get_l2", { symbol, depth: 12 });
    const rate = await view<number>(network, "get_funding_rate_bps", {
      symbol,
    });
    const prints = await priceHistory(network, market.asset_id);
    const chart = await chartCandles(market.asset_id, prints);
    return { ok: true as const, market, book, rate, chart };
  } catch (error) {
    return {
      ok: false as const,
      symbol,
      message:
        error instanceof Error ? error.message : "The market could not be read",
    };
  }
}

export default function MarketPage() {
  const data = useLoaderData<typeof loader>();
  if (!data.ok) {
    return (
      <div className="mx-auto w-full max-w-[1440px] space-y-2 px-3 py-6 md:px-4">
        <Link
          href="/markets"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Markets
        </Link>
        <h1 className="text-xl font-semibold">{data.symbol}</h1>
        <p className="text-sm text-muted-foreground">{data.message}</p>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[1440px] px-3 py-3 md:px-4">
      <TradeDesk
        key={data.market.symbol}
        market={data.market}
        book={data.book}
        fundingBps={data.rate}
        history={data.chart.candles}
        chartNote={data.chart.note}
      />
    </div>
  );
}

async function priceHistory(
  network: Network,
  assetId: string,
): Promise<{ time: number; atoms: string }[]> {
  const oracle = oracleFor(network);
  if (!oracle) return [];
  try {
    const prints = await viewAccount<Print[]>(network, oracle, "get_history", {
      asset_id: assetId,
    });
    return prints.map((print) => ({
      time: print.timestamp_ms,
      atoms: quoteAtoms(print.multiplier, print.decimals),
    }));
  } catch {
    return [];
  }
}

type Print = { timestamp_ms: number; multiplier: string; decimals: number };

function quoteAtoms(multiplier: string, decimals: number) {
  const value = BigInt(multiplier);
  const scale = BigInt(10) ** BigInt(Math.abs(decimals - 6));
  return (decimals >= 6 ? value / scale : value * scale).toString();
}
