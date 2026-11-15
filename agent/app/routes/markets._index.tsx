import { useLoaderData } from "react-router";

import {
  fundingRates,
  MarketBoard,
  Notice,
  PageHead,
  PageShell,
} from "@/marks/components/market-board";
import { SERVED_NETWORK } from "@/marks/lib/network";
import { failed, liveHeaders, missingContract } from "@/marks/lib/page-load";
import { view, type Market } from "@/marks/lib/rpc";
import { marksMeta } from "@/marks/lib/site-meta";

export const meta = () =>
  marksMeta(
    "Marks - Perpetual markets, where you trade crypto, gold, oil and US stocks.",
  );

export const headers = liveHeaders;

export async function loader() {
  const network = SERVED_NETWORK;
  const missing = missingContract(network);
  if (missing) return missing;
  try {
    const markets = await view<Market[]>(network, "get_markets", {});
    return {
      ok: true as const,
      markets,
      rates: await fundingRates(network, markets),
    };
  } catch (error) {
    return failed("The board could not load", error);
  }
}

export default function Board() {
  const data = useLoaderData<typeof loader>();
  return (
    <PageShell>
      {data.ok ? (
        <>
          <PageHead
            title="Long Bitcoin. Short Tesla."
            italic="One balance."
            lede="Trade crypto, gold, oil and US stocks with leverage from a single USDC balance. Borrow against a winning position, or send it to a friend as a link."
          />
          <MarketBoard markets={data.markets} rates={data.rates} />
        </>
      ) : (
        <Notice title={data.title} body={data.body} />
      )}
    </PageShell>
  );
}
