import { defineEventHandler } from "h3";

import {
  MAX_INVOICE_ATOMS,
  invoiceAtoms,
  nearAccount,
} from "../../../../app/marks/lib/checkout-request";
import { createPayment, publicPayment } from "../../../marks/payments";

async function post(request: Request) {
  const incoming = (await request.json().catch(() => null)) as {
    amount?: string;
    recipient?: string;
  } | null;
  const recipient = nearAccount(String(incoming?.recipient ?? ""));
  const amount = String(incoming?.amount ?? "").trim();
  const atoms = invoiceAtoms(amount);
  if (!recipient) {
    return Response.json(
      { error: "Sign in with the account that should be paid." },
      { status: 400 },
    );
  }
  if (!atoms || atoms > MAX_INVOICE_ATOMS) {
    return Response.json(
      { error: "A payment link is from $0.01 to $10,000." },
      { status: 400 },
    );
  }
  const row = await createPayment({
    amount,
    atoms: atoms.toString(),
    recipient,
  });
  return Response.json(
    { payment: publicPayment(row) },
    { headers: { "cache-control": "no-store" } },
  );
}

export default defineEventHandler((event) => post(event.req));
