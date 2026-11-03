import Link from "next/link";
import { dollars, quote } from "@/lib/format";
import { contractFor, type Network } from "@/lib/network";
import { selectedNetwork } from "@/lib/network-server";
import { view, type Market } from "@/lib/rpc";

export const dynamic = "force-dynamic";

export default async function Board() {
  const network = await selectedNetwork();
  const id = contractFor(network);
  if (!id) {
    return (
      <Notice
        title={network === "mainnet" ? "Mainnet has no listing" : "No contract configured"}
        body={
          network === "mainnet"
            ? "Set NEXT_PUBLIC_MAINNET_CONTRACT_ID when a mainnet account is deployed. The header switch selects testnet, where NEAR-PERP is listed."
            : "Set NEXT_PUBLIC_CONTRACT_ID to the testnet account that holds Marks."
        }
      />
    );
  }
  try {
    const markets = await view<Market[]>(network, "get_markets", {});
    if (markets.length === 0) {
      return (
        <Notice title="No markets yet" body={`${id} has no listings. create_market adds a row.`} />
      );
    }
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Markets</h1>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            Each row is a listing. The mark comes from the oracle. Open interest is the sum of long
            lots.
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Symbol</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Mark</th>
                <th className="px-4 py-3 font-medium">Funding</th>
                <th className="px-4 py-3 font-medium">Open interest</th>
                <th className="px-4 py-3 font-medium">Volume</th>
              </tr>
            </thead>
            <tbody>
              {markets.map((market) => (
                <tr key={market.symbol} className="border-b border-border last:border-0">
                  <td className="px-4 py-4">
                    <Link
                      href={`/markets/${market.symbol}`}
                      className="font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {market.symbol}
                    </Link>
                  </td>
                  <td className="px-4 py-4 text-muted-foreground">{market.category}</td>
                  <td className="px-4 py-4 font-mono">
                    {dollars(market.mark_ticks, market.tick_size)}
                  </td>
                  <td className="px-4 py-4 font-mono">
                    <Funding network={network} symbol={market.symbol} />
                  </td>
                  <td className="px-4 py-4 font-mono">{market.open_interest_lots}</td>
                  <td className="px-4 py-4 font-mono">{quote(market.volume_quote)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "The RPC call failed";
    return <Notice title="The board could not load" body={message} />;
  }
}

async function Funding({ network, symbol }: { network: Network; symbol: string }) {
  try {
    const rate = await view<number>(network, "get_funding_rate_bps", { symbol });
    return <>{rate} bps</>;
  } catch {
    return <>{"\u2014"}</>;
  }
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-prose space-y-2 rounded-lg border border-border bg-card p-6">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
