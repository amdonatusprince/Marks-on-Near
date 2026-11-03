import { Notice, PageShell } from "@/components/market-board";
import { SendPage } from "@/components/send-page";
import { contractFor } from "@/lib/network";
import { selectedNetwork } from "@/lib/network-server";
import type { Market } from "@/lib/rpc";
import { viewMarks, type Share } from "@/lib/v2";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Send a gift",
  description: "Send a share, USDC or a perp position as one link your friend opens with Google.",
};

export default async function Send() {
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
    const [shares, markets] = await Promise.all([
      viewMarks<Share[]>(network, "get_shares"),
      viewMarks<Market[]>(network, "get_markets"),
    ]);
    return <SendPage shares={shares} markets={markets} />;
  } catch (error) {
    return (
      <PageShell>
        <Notice
          title="Gifts could not load"
          body={error instanceof Error ? error.message : "The RPC call failed"}
        />
      </PageShell>
    );
  }
}
