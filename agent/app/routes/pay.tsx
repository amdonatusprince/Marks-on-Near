import { PageHead, PageShell } from "@/marks/components/market-board";
import { PaymentLink } from "@/marks/components/pay-desk";
import { marksMeta } from "@/marks/lib/site-meta";

export const meta = () => marksMeta("Marks - Payment link");

export default function PayPage() {
  return (
    <PageShell>
      <div className="mx-auto w-full max-w-xl">
        <PageHead
          center
          title="A payment link."
          italic="One amount."
          lede="Create a link for the amount you want to collect."
        />
        <PaymentLink />
      </div>
    </PageShell>
  );
}
