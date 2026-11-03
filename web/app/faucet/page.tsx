import { FaucetDesk } from "@/components/faucet-desk";
import { PageHead, PageShell } from "@/components/market-board";

export const metadata = { title: "Faucet" };

export default function FaucetPage() {
  return (
    <PageShell>
      <PageHead
        label="Testnet money · one claim a day"
        title="Free USDC,"
        italic="to try it all."
        lede="Claim mock USDC, move it into Marks, and use it everywhere: perps, shares, capped calls, loans and gifts."
      />
      <FaucetDesk />
    </PageShell>
  );
}
