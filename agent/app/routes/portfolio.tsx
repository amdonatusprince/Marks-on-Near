import { useLoaderData } from "react-router";

import { Notice, PageHead, PageShell } from "@/marks/components/market-board";
import { PortfolioDesk } from "@/marks/components/portfolio-desk";
import { SERVED_NETWORK } from "@/marks/lib/network";
import { failed, liveHeaders, missingContract } from "@/marks/lib/page-load";
import type { Market } from "@/marks/lib/rpc";
import { marksMeta } from "@/marks/lib/site-meta";
import { viewMarks, type Series, type Share } from "@/marks/lib/v2";

export const meta = () => marksMeta("Marks - Portfolio");

export const headers = liveHeaders;

export async function loader() {
  const network = SERVED_NETWORK;
  const missing = missingContract(network, "No contract configured");
  if (missing) return missing;
  try {
    const [markets, shares, series] = await Promise.all([
      viewMarks<Market[]>(network, "get_markets"),
      viewMarks<Share[]>(network, "get_shares"),
      viewMarks<Series[]>(network, "get_series_list"),
    ]);
    return { ok: true as const, markets, shares, series };
  } catch (error) {
    return failed("The portfolio could not load", error);
  }
}

export default function PortfolioPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <PageShell>
      {data.ok ? (
        <>
          <PageHead
            label="Everything you hold"
            title="Your"
            italic="portfolio."
          />
          <PortfolioDesk
            markets={data.markets}
            shares={data.shares}
            series={data.series}
          />
        </>
      ) : (
        <Notice title={data.title} body={data.body} />
      )}
    </PageShell>
  );
}
