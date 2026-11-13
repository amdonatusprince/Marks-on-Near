import { defineEventHandler } from "h3";

import { nearAccount } from "../../../../app/marks/lib/checkout-request";
import { MARKS_CONTRACT, MARKS_RPC } from "../../../../shared/marks";
import { markPaid, paymentIdOk, readPayment } from "../../../marks/payments";

const HASH = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;

function decodeArgs(value: unknown) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4000) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64").toString("utf8"),
    ) as {
      merchant?: unknown;
      amount?: unknown;
    };
    return parsed;
  } catch {
    return null;
  }
}

function callsPay(value: unknown, merchant: string, atoms: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item) => callsPay(item, merchant, atoms));
  }
  const record = value as Record<string, unknown>;
  const call = (
    record.FunctionCall && typeof record.FunctionCall === "object"
      ? record.FunctionCall
      : record
  ) as Record<string, unknown>;
  if (call.method_name === "pay") {
    const args = decodeArgs(call.args);
    if (
      args &&
      String(args.merchant) === merchant &&
      String(args.amount) === atoms
    ) {
      return true;
    }
  }
  return Object.values(record).some((item) =>
    item && typeof item === "object" ? callsPay(item, merchant, atoms) : false,
  );
}

async function post(request: Request) {
  const incoming = (await request.json().catch(() => null)) as {
    id?: string;
    hash?: string;
    account?: string;
  } | null;
  const id = String(incoming?.id ?? "");
  const hash = String(incoming?.hash ?? "");
  const account = nearAccount(String(incoming?.account ?? ""));
  if (!paymentIdOk(id) || !HASH.test(hash) || !account) {
    return Response.json(
      { error: "The payment proof is incomplete." },
      { status: 400 },
    );
  }
  const payment = await readPayment(id);
  if (!payment) {
    return Response.json({ error: "Unknown payment link." }, { status: 404 });
  }
  if (payment.status === "paid") return Response.json({ ok: true });
  const response = await fetch(MARKS_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "marks",
      method: "tx",
      params: {
        tx_hash: hash,
        sender_account_id: account,
        wait_until: "EXECUTED",
      },
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    result?: {
      status?: Record<string, unknown>;
      transaction?: { receiver_id?: string };
    };
  } | null;
  const status = body?.result?.status;
  const settled = Boolean(
    status && ("SuccessValue" in status || "SuccessReceiptId" in status),
  );
  const receiver = body?.result?.transaction?.receiver_id;
  if (
    !settled ||
    receiver !== MARKS_CONTRACT ||
    !callsPay(body?.result, payment.recipient, payment.atoms)
  ) {
    return Response.json(
      { error: "That transaction did not pay this link." },
      { status: 400 },
    );
  }
  await markPaid(id);
  return Response.json({ ok: true });
}

export default defineEventHandler((event) => post(event.req));
