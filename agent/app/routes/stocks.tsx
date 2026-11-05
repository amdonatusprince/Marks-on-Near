import { useLoaderData } from "react-router";

import { Notice, PageHead, PageShell } from "@/marks/components/market-board";
import { StocksDesk } from "@/marks/components/stocks-desk";
import { SERVED_NETWORK } from "@/marks/lib/network";
import { failed, liveHeaders, missingContract } from "@/marks/lib/page-load";
import { marksMeta } from "@/marks/lib/site-meta";
import { viewMarks, type Series, type Share } from "@/marks/lib/v2";

export const meta = () => marksMeta("Marks - Stocks and calls");

export const headers = liveHeaders;

export async function loader() {
  const network = SERVED_NETWORK;
  const missing = missingContract(network, "No contract configured");
  if (missing) return missing;
  try {
    const [shares, series] = await Promise.all([
      viewMarks<Share[]>(network, "get_shares"),
      viewMarks<Series[]>(network, "get_series_list"),
    ]);
    return { ok: true as const, shares, series };
  } catch (error) {
    return failed("Shares could not load", error);
  }
}

export default function StocksPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <PageShell>
      {data.ok ? (
        <>
          <PageHead
            title="Own the share,"
            italic="or cap the bet."
            lede="Shares trade at the oracle price with no spread. A capped call pays the rise from strike to cap at expiry. The premium you pay is the most you can lose."
          />
          <StocksDesk shares={data.shares} series={data.series} />
        </>
      ) : (
        <Notice title={data.title} body={data.body} />
      )}
    </PageShell>
  );
}
