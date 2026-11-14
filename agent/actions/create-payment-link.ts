import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  MAX_INVOICE_ATOMS,
  invoiceAtoms,
  nearAccount,
  paymentPath,
} from "../app/marks/lib/checkout-request";
import { money } from "../app/marks/lib/format";
import { deskAccount } from "../server/marks/desk-tab";
import { createPayment } from "../server/marks/payments";

const NO_DESK =
  "No Marks tab with a connected NEAR wallet is open. Ask them to keep the Marks tab open with the wallet signed in, then refresh that tab.";

export default defineAction({
  description:
    "Create a payment link that pays the NEAR account signed in on the Marks tab. amount is dollars, from 0.01 to 10000. Returns path /checkout/<id>. A .testnet account is paid with Marks through pay-bill. A mainnet account is paid by the person on that page through NEAR Intents. The agent never sends the Intents deposit.",
  schema: z.object({
    amount: z.string().describe("USDC dollars, such as 40."),
  }),
  mcpTool: true,
  run: async ({ amount }) => {
    const signedIn = await deskAccount("pay-bill");
    const recipient = nearAccount(signedIn ?? "");
    if (!recipient) return { ok: false, error: NO_DESK };
    const text = amount.trim();
    const atoms = invoiceAtoms(text);
    if (!atoms || atoms > MAX_INVOICE_ATOMS) {
      return { ok: false, error: "A payment link is from $0.01 to $10,000." };
    }
    const row = await createPayment({
      amount: text,
      atoms: atoms.toString(),
      recipient,
    });
    const marks = recipient.endsWith(".testnet");
    return {
      ok: true,
      id: row.id,
      path: paymentPath(row.id),
      amount: row.amount,
      dollars: money(row.atoms),
      recipient: row.recipient,
      status: row.status,
      createdAt: row.createdAt,
      payWith: marks ? "marks" : "intents",
    };
  },
});
