"use client";

import { useToast } from "@/components/toast";
import { useState } from "react";

export function DepositPanel() {
  const toast = useToast();
  const [dry, setDry] = useState(true);
  const [busy, setBusy] = useState(false);

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium">Deposit from another chain</h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        NEAR Intents has no testnet. This asks 1Click for a quote from USDC on Arbitrum into USDC on
        NEAR. The default is a dry quote, which spends nothing and does not return a deposit
        address.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!dry}
          onChange={(event) => setDry(!event.target.checked)}
          className="size-4 focus-visible:ring-2 focus-visible:ring-ring"
        />
        Send funds. This spends real USDC on mainnet.
      </label>
      <button
        type="button"
        disabled={busy}
        className="h-10 rounded-md bg-primary px-4 text-sm text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
        onClick={() => {
          setBusy(true);
          void fetch("/api/quote", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ dry }),
          })
            .then(async (response) => {
              const body = (await response.json()) as {
                quote?: { amountOut?: string };
                message?: string;
              };
              if (!response.ok || !body.quote?.amountOut) {
                throw new Error(body.message ?? "No output amount");
              }
              toast.success(`Output amount ${body.quote.amountOut}`);
            })
            .catch((caught) =>
              toast.error(caught instanceof Error ? caught.message : "The quote failed"),
            )
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Requesting quote" : dry ? "Dry quote" : "Live quote"}
      </button>
    </section>
  );
}
