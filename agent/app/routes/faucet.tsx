import { FaucetDesk } from "@/marks/components/faucet-desk";
import { PageHead, PageShell } from "@/marks/components/market-board";
import { marksMeta } from "@/marks/lib/site-meta";

export const meta = () => marksMeta("Marks - Faucet");

export default function FaucetPage() {
  return (
    <PageShell>
      <PageHead
        title="Free USDC,"
        italic="to try it all."
        lede="Claim mock USDC, move it into Marks, and use it everywhere: perps, shares, capped calls, loans and gifts."
      />
      <FaucetDesk />
    </PageShell>
  );
}
