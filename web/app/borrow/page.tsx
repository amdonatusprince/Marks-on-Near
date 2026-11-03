import { BorrowDesk } from "@/components/borrow-desk";
import { Notice, PageHead, PageShell } from "@/components/market-board";
import { contractFor } from "@/lib/network";
import { selectedNetwork } from "@/lib/network-server";
import type { Market } from "@/lib/rpc";
import { viewMarks, type Pool, type Share } from "@/lib/v2";

export const dynamic = "force-dynamic";
export const metadata = { title: "Borrow" };

export default async function BorrowPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string; asset?: string }>;
}) {
  const { symbol, asset } = await searchParams;
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
    const [markets, shares, pool] = await Promise.all([
      viewMarks<Market[]>(network, "get_markets"),
      viewMarks<Share[]>(network, "get_shares"),
      viewMarks<Pool>(network, "get_pool"),
    ]);
    return (
      <PageShell>
        <PageHead
          label="Marks lends · 1 percent fee"
          title="Spend it"
          italic="without selling it."
          lede="Borrow USDC against an open perp or against your shares. The loan is repaid first if the position is liquidated, so the pool is always made whole."
        />
        <BorrowDesk
          markets={markets}
          shares={shares}
          pool={pool}
          initialSymbol={symbol}
          initialAsset={asset}
        />
      </PageShell>
    );
  } catch (error) {
    return (
      <PageShell>
        <Notice
          title="Loans could not load"
          body={error instanceof Error ? error.message : "The RPC call failed"}
        />
      </PageShell>
    );
  }
}
