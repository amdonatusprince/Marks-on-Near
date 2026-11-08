import { Notice, PageHead, PageShell } from "@/components/market-board";
import { PortfolioDesk } from "@/components/portfolio-desk";
import { contractFor } from "@/lib/network";
import { selectedNetwork } from "@/lib/network-server";
import type { Market } from "@/lib/rpc";
import { viewMarks, type Series, type Share } from "@/lib/v2";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portfolio" };

export default async function PortfolioPage() {
  const network = await selectedNetwork();
  if (!contractFor(network)) {
    return (
      <PageShell>
        <Notice
          title="No contract configured"
          body="Set NEXT_PUBLIC_CONTRACT_ID to the testnet account that holds Marks v2."
        />
      </PageShell>
    );
  }
  try {
    const [markets, shares, series] = await Promise.all([
      viewMarks<Market[]>(network, "get_markets"),
      viewMarks<Share[]>(network, "get_shares"),
      viewMarks<Series[]>(network, "get_series_list"),
    ]);
    return (
      <PageShell>
        <PageHead label="Everything you hold" title="Your" italic="portfolio." />
        <PortfolioDesk markets={markets} shares={shares} series={series} />
      </PageShell>
    );
  } catch (error) {
    return (
      <PageShell>
        <Notice
          title="The portfolio could not load"
          body={error instanceof Error ? error.message : "The RPC call failed"}
        />
      </PageShell>
    );
  }
}
