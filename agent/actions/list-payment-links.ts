import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  nearAccount,
  paymentPath,
  paymentStanding,
} from "../app/marks/lib/checkout-request";
import { money } from "../app/marks/lib/format";
import { deskAccount } from "../server/marks/desk-tab";
import { listPayments, publicPayment } from "../server/marks/payments";

const NO_DESK =
  "No Marks tab with a connected NEAR wallet is open. Ask them to keep the Marks tab open with the wallet signed in, then refresh that tab.";

export default defineAction({
  description:
    "List payment links created for the NEAR account signed in on the Marks tab, newest first. Each row has id, path, amount, and status. status is expired once the quote deadline has passed, even if settlement has not moved. Does not include a deposit address.",
  schema: z.object({}),
  readOnly: true,
  mcpTool: true,
  run: async () => {
    const signedIn = await deskAccount("pay-bill");
    const recipient = nearAccount(signedIn ?? "");
    if (!recipient) return { ok: false, error: NO_DESK };
    const rows = await listPayments(recipient);
    return {
      recipient,
      links: rows.map((row) => {
        const payment = publicPayment(row);
        const standing = paymentStanding(payment);
        return {
          id: payment.id,
          path: paymentPath(payment.id),
          amount: payment.amount,
          dollars: money(payment.atoms),
          status: standing,
          createdAt: payment.createdAt,
          expiresAt: payment.expiresAt ?? null,
          expired: standing === "expired",
          payWith: payment.recipient.endsWith(".testnet") ? "marks" : "intents",
        };
      }),
    };
  },
});
