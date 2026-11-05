import { useLoaderData } from "react-router";

import { Notice, PageShell } from "@/marks/components/market-board";
import { SendPage } from "@/marks/components/send-page";
import { SERVED_NETWORK } from "@/marks/lib/network";
import { failed, liveHeaders, missingContract } from "@/marks/lib/page-load";
import type { Market } from "@/marks/lib/rpc";
import { marksMeta } from "@/marks/lib/site-meta";
import { viewMarks, type Share } from "@/marks/lib/v2";

export const meta = () =>
  marksMeta(
    "Marks - Send a gift",
    "Send a share, USDC or a perp position as one link your friend opens with Google.",
  );

export const headers = liveHeaders;

export async function loader() {
  const network = SERVED_NETWORK;
  const missing = missingContract(network, "No contract configured");
  if (missing) return missing;
  try {
    const [shares, markets] = await Promise.all([
      viewMarks<Share[]>(network, "get_shares"),
      viewMarks<Market[]>(network, "get_markets"),
    ]);
    return { ok: true as const, shares, markets };
  } catch (error) {
    return failed("Gifts could not load", error);
  }
}

export default function Send() {
  const data = useLoaderData<typeof loader>();
  if (data.ok) return <SendPage shares={data.shares} markets={data.markets} />;
  return (
    <PageShell>
      <Notice title={data.title} body={data.body} />
    </PageShell>
  );
}
