import { defineEventHandler } from "h3";

import { nearAccount } from "../../../../app/marks/lib/checkout-request";
import type { PaymentIntent } from "../../../../app/marks/lib/checkout-request";
import { paymentCode } from "../../../marks/payment-code";
import {
  intentStanding,
  listPayments,
  markIntent,
  markQuoted,
  paymentIdOk,
  publicPayment,
  readPayment,
  type StoredPayment,
} from "../../../marks/payments";

async function refresh(row: StoredPayment) {
  if (row.status !== "processing" || !row.depositAddress) return;
  const response = await fetch(
    `https://1click.chaindefuser.com/v0/status?depositAddress=${encodeURIComponent(row.depositAddress)}`,
  );
  const body = (await response.json().catch(() => null)) as {
    status?: string;
    quoteResponse?: {
      quoteRequest?: { originAsset?: string; deadline?: string };
      quote?: {
        amountIn?: string | undefined;
        amountInFormatted?: string | undefined;
        depositMemo?: string | null | undefined;
      };
    };
  } | null;
  if (body?.status && intentStanding(body.status)) {
    await markIntent(row.id, row.depositAddress, body.status);
  }
  const amountIn = body?.quoteResponse?.quote?.amountIn;
  const originAsset = body?.quoteResponse?.quoteRequest?.originAsset;
  const expiresAt =
    row.expiresAt || body?.quoteResponse?.quoteRequest?.deadline;
  if (
    !amountIn ||
    !originAsset ||
    !expiresAt ||
    (row.amountIn && row.originAsset)
  ) {
    return;
  }
  await markQuoted(row.id, {
    depositAddress: row.depositAddress,
    expiresAt,
    originAsset,
    amountIn,
    amountInFormatted: body?.quoteResponse?.quote?.amountInFormatted,
    depositMemo: body?.quoteResponse?.quote?.depositMemo,
  });
}

async function get(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  if (id) {
    if (!paymentIdOk(id)) {
      return Response.json({ error: "Unknown payment link." }, { status: 404 });
    }
    const row = await readPayment(id);
    if (!row) {
      return Response.json({ error: "Unknown payment link." }, { status: 404 });
    }
    await refresh(row);
    const fresh = (await readPayment(id)) ?? row;
    const expired = linkExpired(fresh);
    const intent = expired ? null : await openIntent(fresh);
    return Response.json(
      { payment: publicPayment(fresh), intent, expired },
      { headers: { "cache-control": "no-store" } },
    );
  }
  const account = nearAccount(params.get("account") ?? "");
  if (!account) {
    return Response.json(
      { error: "Sign in to see your payment links." },
      { status: 400 },
    );
  }
  const rows = await listPayments(account);
  await Promise.all(rows.map((row) => refresh(row).catch(() => undefined)));
  const fresh = await listPayments(account);
  return Response.json(
    { payments: fresh.map(publicPayment) },
    { headers: { "cache-control": "no-store" } },
  );
}

export default defineEventHandler((event) => get(event.req));

function linkExpired(row: StoredPayment) {
  if (!row.expiresAt || row.status === "paid") return false;
  const end = Date.parse(row.expiresAt);
  return !Number.isNaN(end) && end <= Date.now();
}

async function openIntent(row: StoredPayment): Promise<PaymentIntent | null> {
  if (!row.depositAddress || !row.expiresAt || row.status === "paid")
    return null;
  const pay =
    row.originAsset && row.amountIn
      ? await paymentCode(
          row.originAsset,
          row.depositAddress,
          row.amountIn,
          row.depositMemo,
        )
      : null;
  return {
    depositAddress: row.depositAddress,
    expiresAt: row.expiresAt,
    amountIn: row.amountIn,
    amountInFormatted: row.amountInFormatted,
    depositMemo: row.depositMemo,
    originAsset: row.originAsset,
    pay,
  };
}
