import { Notice, PageHead, PageShell } from "@/components/market-board";
import { StocksDesk } from "@/components/stocks-desk";
import { contractFor } from "@/lib/network";
import { selectedNetwork } from "@/lib/network-server";
import { viewMarks, type Series, type Share } from "@/lib/v2";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stocks and calls" };

export default async function StocksPage() {
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
    const [shares, series] = await Promise.all([
      viewMarks<Share[]>(network, "get_shares"),
      viewMarks<Series[]>(network, "get_series_list"),
    ]);
    return (
      <PageShell>
        <PageHead
          label="Seven assets · priced by the oracle"
          title="Own the share,"
          italic="or cap the bet."
          lede="Shares trade at the oracle price with no spread. A capped call pays the rise from strike to cap at expiry. The premium you pay is the most you can lose."
        />
        <StocksDesk shares={shares} series={series} />
      </PageShell>
    );
  } catch (error) {
    return (
      <PageShell>
        <Notice
          title="Shares could not load"
          body={error instanceof Error ? error.message : "The RPC call failed"}
        />
      </PageShell>
    );
  }
}
