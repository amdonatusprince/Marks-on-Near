import { useLoaderData, useSearchParams } from "react-router";

import { BorrowDesk } from "@/marks/components/borrow-desk";
import { Notice, PageHead, PageShell } from "@/marks/components/market-board";
import { SERVED_NETWORK } from "@/marks/lib/network";
import { failed, liveHeaders, missingContract } from "@/marks/lib/page-load";
import type { Market } from "@/marks/lib/rpc";
import { marksMeta } from "@/marks/lib/site-meta";
import { viewMarks, type Pool, type Share } from "@/marks/lib/v2";

export const meta = () => marksMeta("Marks - Borrow");

export const headers = () => ({
  ...liveHeaders(),
  "x-agent-native-ssr-key": "query",
});

export async function loader() {
  const network = SERVED_NETWORK;
  const missing = missingContract(network, "No contract configured");
  if (missing) return missing;
  try {
    const [markets, shares, pool] = await Promise.all([
      viewMarks<Market[]>(network, "get_markets"),
      viewMarks<Share[]>(network, "get_shares"),
      viewMarks<Pool>(network, "get_pool"),
    ]);
    return { ok: true as const, markets, shares, pool };
  } catch (error) {
    return failed("Loans could not load", error);
  }
}

export default function BorrowPage() {
  const data = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  return (
    <PageShell>
      {data.ok ? (
        <>
          <PageHead
            title="Spend it"
            italic="without selling it."
            lede="Borrow USDC against an open perp or against your shares. The loan is repaid first if the position is liquidated, so the pool is always made whole."
          />
          <BorrowDesk
            markets={data.markets}
            shares={data.shares}
            pool={data.pool}
            initialSymbol={params.get("symbol") ?? undefined}
            initialAsset={params.get("asset") ?? undefined}
          />
        </>
      ) : (
        <Notice title={data.title} body={data.body} />
      )}
    </PageShell>
  );
}
