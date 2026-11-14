import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  paymentPath,
  paymentStanding,
} from "../app/marks/lib/checkout-request";
import { money } from "../app/marks/lib/format";
import {
  paymentIdOk,
  publicPayment,
  readPayment,
} from "../server/marks/payments";

export default defineAction({
  description:
    "Read one payment link by id. Returns the amount, the account that gets paid, and the status. status is expired once the quote deadline has passed. payWith marks means pay-bill { paymentId } can pay it on testnet. payWith intents means the person pays on the checkout page from their own wallet. Does not include a deposit address.",
  schema: z.object({
    id: z.string().describe("The 16-character id in /checkout/<id>."),
  }),
  readOnly: true,
  mcpTool: true,
  run: async ({ id }) => {
    if (!paymentIdOk(id)) {
      return { ok: false, error: "That is not a payment link id." };
    }
    const row = await readPayment(id);
    if (!row) return { ok: false, error: "This payment link does not exist." };
    const payment = publicPayment(row);
    const standing = paymentStanding(payment);
    return {
      ok: true,
      id: payment.id,
      path: paymentPath(payment.id),
      amount: payment.amount,
      dollars: money(payment.atoms),
      recipient: payment.recipient,
      status: standing,
      createdAt: payment.createdAt,
      expiresAt: payment.expiresAt ?? null,
      expired: standing === "expired",
      payWith: payment.recipient.endsWith(".testnet") ? "marks" : "intents",
    };
  },
});
