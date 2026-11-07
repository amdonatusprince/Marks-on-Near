import { MarketBoard, Notice, PageHead, PageShell } from "@/components/market-board";
import { contractFor } from "@/lib/network";
import { selectedNetwork } from "@/lib/network-server";
import { view, type Market } from "@/lib/rpc";

export const dynamic = "force-dynamic";
export const metadata = { title: "Perps" };

export default async function Board() {
  const network = await selectedNetwork();
  if (!contractFor(network)) {
    return (
      <PageShell>
        <Notice
          title={network === "mainnet" ? "Mainnet has no listing" : "No contract configured"}
          body="Set NEXT_PUBLIC_CONTRACT_ID to the testnet account that holds Marks v2."
        />
      </PageShell>
    );
  }
  try {
    const markets = await view<Market[]>(network, "get_markets", {});
    return (
      <PageShell>
        <PageHead
          label="12 markets · up to 10x · settled in USDC"
          title="Long Bitcoin. Short Tesla."
          italic="One balance."
          lede="Trade crypto, gold, oil and US stocks with leverage from a single USDC balance. Borrow against a winning position, or send it to a friend as a link."
        />
        <MarketBoard network={network} markets={markets} />
      </PageShell>
    );
  } catch (error) {
    return (
      <PageShell>
        <Notice
          title="The board could not load"
          body={error instanceof Error ? error.message : "The RPC call failed"}
        />
      </PageShell>
    );
  }
}
