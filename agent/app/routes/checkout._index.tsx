import { PageShell } from "@/marks/components/market-board";
import Link from "@/marks/components/link";
import { marksMeta } from "@/marks/lib/site-meta";

export const meta = () => marksMeta("Marks - Checkout");

export default function CheckoutIndex() {
  return (
    <PageShell>
      <div className="panel mx-auto max-w-xl space-y-3 p-5">
        <p>This page opens from a payment link.</p>
        <Link href="/pay" className="btn-gold text-sm">
          Create a payment link
        </Link>
      </div>
    </PageShell>
  );
}
