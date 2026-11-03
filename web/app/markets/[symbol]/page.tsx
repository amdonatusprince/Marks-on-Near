import { TradeDesk } from "@/components/trade-desk";
import { contractFor } from "@/lib/network";
import { selectedNetwork } from "@/lib/network-server";
import { view, type Book, type Market } from "@/lib/rpc";
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
    return <TradeDesk market={market} book={book} fundingBps={rate} />;
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
