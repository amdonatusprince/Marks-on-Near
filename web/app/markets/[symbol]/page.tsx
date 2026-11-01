import { TradeDesk } from "@/components/trade-desk";
import { contractFor, oracleFor, type Network } from "@/lib/network";
import { chartCandles } from "@/lib/ohlc";
import { selectedNetwork } from "@/lib/network-server";
import { view, viewAccount, type Book, type Market } from "@/lib/rpc";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function MarketPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const network = await selectedNetwork();
  const id = contractFor(network);
  if (!id) {
    return (
      <div className="max-w-prose space-y-2">
        <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          Markets
        </Link>
        <h1 className="text-xl font-semibold">{symbol}</h1>
        <p className="text-sm text-muted-foreground">
          {network === "mainnet"
            ? "Mainnet has no listing. The header switch selects testnet, where NEAR-PERP is listed."
            : "Set NEXT_PUBLIC_CONTRACT_ID to the testnet account that holds Marks."}
        </p>
      </div>
    );
  }
  try {
    const market = await view<Market>(network, "get_market", { symbol });
    const book = await view<Book>(network, "get_l2", { symbol, depth: 12 });
    const rate = await view<number>(network, "get_funding_rate_bps", { symbol });
    const prints = await priceHistory(network, market.asset_id);
    const chart = await chartCandles(market.asset_id, prints);
    return (
      <TradeDesk
        market={market}
        book={book}
        fundingBps={rate}
        history={chart.candles}
        chartNote={chart.note}
      />
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "The market could not be read";
    return (
      <div className="max-w-prose space-y-2">
        <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          Markets
        </Link>
        <h1 className="text-xl font-semibold">{symbol}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    );
  }
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
