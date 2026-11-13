import { useEffect, useState } from "react";
import { useLoaderData, useParams } from "react-router";

import { CheckoutDesk } from "@/marks/components/checkout-desk";
import { Notice, PageShell } from "@/marks/components/market-board";
import { Spinner } from "@/marks/components/v2-ui";
import type {
  PaymentIntent,
  PaymentRecord,
} from "@/marks/lib/checkout-request";
import { SERVED_NETWORK } from "@/marks/lib/network";
import { failed, liveHeaders, missingContract } from "@/marks/lib/page-load";
import type { Market } from "@/marks/lib/rpc";
import { marksMeta } from "@/marks/lib/site-meta";
import { viewMarks, type Share } from "@/marks/lib/v2";

export const meta = () => marksMeta("Marks - Checkout");

export const headers = () => ({
  ...liveHeaders(),
  "cache-control": "no-store",
});

export async function loader() {
  const network = SERVED_NETWORK;
  const missing = missingContract(network, "No contract configured");
  if (missing) return missing;
  try {
    const [markets, shares] = await Promise.all([
      viewMarks<Market[]>(network, "get_markets"),
      viewMarks<Share[]>(network, "get_shares"),
    ]);
    return { ok: true as const, markets, shares };
  } catch (error) {
    return failed("Checkout could not load", error);
  }
}

export default function CheckoutById() {
  const { id = "" } = useParams();
  const data = useLoaderData<typeof loader>();
  const [loaded, setLoaded] = useState<
    { payment: PaymentRecord; intent: PaymentIntent | null } | null | undefined
  >(undefined);

  useEffect(() => {
    let cancelled = false;
    setLoaded(undefined);
    void fetch(`/api/checkout/links?id=${encodeURIComponent(id)}`)
      .then(async (response) => {
        const body = (await response.json()) as {
          payment?: PaymentRecord;
          intent?: PaymentIntent | null;
        };
        if (cancelled) return;
        setLoaded(
          response.ok && body.payment
            ? { payment: body.payment, intent: body.intent ?? null }
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setLoaded(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <PageShell>
      {!data.ok ? (
        <Notice title={data.title} body={data.body} />
      ) : loaded === undefined ? (
        <Spinner />
      ) : loaded === null ? (
        <div className="panel mx-auto max-w-xl space-y-2 p-5">
          <p>This payment link does not exist.</p>
        </div>
      ) : (
        <CheckoutDesk
          payment={loaded.payment}
          intent={loaded.intent}
          markets={data.markets}
          shares={data.shares}
        />
      )}
    </PageShell>
  );
}
