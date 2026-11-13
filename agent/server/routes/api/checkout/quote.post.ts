import { defineEventHandler } from "h3";

import {
  checkoutBody,
  refundAddress,
} from "../../../../app/marks/lib/checkout-request";
import { paymentCode } from "../../../marks/payment-code";
import { markQuoted, paymentIdOk, readPayment } from "../../../marks/payments";

const ASSET = /^(nep141:|nep245:|1cs_v1:)[A-Za-z0-9_.:-]{3,160}$/;

async function post(request: Request) {
  const incoming = (await request.json().catch(() => null)) as {
    dry?: boolean;
    originAsset?: string;
    paymentId?: string;
    refundTo?: string;
  } | null;
  const paymentId = String(incoming?.paymentId ?? "");
  const payment = paymentIdOk(paymentId) ? await readPayment(paymentId) : null;
  const recipient = payment?.recipient ?? "";
  const refundTo = refundAddress(String(incoming?.refundTo ?? ""));
  const originAsset = String(incoming?.originAsset ?? "");
  let amount = BigInt(0);
  try {
    amount = BigInt(payment?.atoms ?? "0");
  } catch {
    amount = BigInt(0);
  }
  if (!payment) {
    return Response.json(
      { error: "This payment link does not exist." },
      { status: 404 },
    );
  }
  if (payment.status === "paid") {
    return Response.json(
      { error: "This payment link is already paid." },
      { status: 400 },
    );
  }
  if (payment.expiresAt && Date.parse(payment.expiresAt) <= Date.now()) {
    return Response.json(
      { error: "This payment link has expired." },
      { status: 400 },
    );
  }
  if (payment.depositAddress && payment.expiresAt) {
    return Response.json(
      { error: "This payment is already open." },
      { status: 400 },
    );
  }
  if (!recipient || recipient.endsWith(".testnet")) {
    return Response.json(
      {
        error:
          "Pay with Intents can only deliver USDC to a NEAR mainnet account. This link pays a testnet account.",
      },
      { status: 400 },
    );
  }
  if (!refundTo) {
    return Response.json(
      {
        error:
          "Enter the address that will send the payment, so a failed swap can refund it.",
      },
      { status: 400 },
    );
  }
  if (!ASSET.test(originAsset)) {
    return Response.json(
      { error: "Pick a token NEAR Intents can accept." },
      { status: 400 },
    );
  }
  if (amount <= BigInt(0)) {
    return Response.json(
      { error: "This payment link has no amount." },
      { status: 400 },
    );
  }
  const dry = incoming?.dry === true;
  const payload = checkoutBody({
    dry,
    originAsset,
    amount: amount.toString(),
    recipient,
    refundTo,
  });
  const response = await fetch("https://1click.chaindefuser.com/v0/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({
    error: "Quote failed",
  }))) as {
    message?: string;
    quote?: {
      depositAddress?: string | undefined;
      amountIn?: string | undefined;
      amountInFormatted?: string | undefined;
      depositMemo?: string | null | undefined;
    };
  };
  if (body.message === "Internal server error") {
    return Response.json(
      {
        error:
          "NEAR Intents could not pay this account. The merchant has to be a NEAR mainnet account that can receive USDC.",
      },
      { status: 400 },
    );
  }
  if (response.ok && !dry && body.quote?.depositAddress) {
    await markQuoted(paymentId, {
      depositAddress: body.quote.depositAddress,
      expiresAt: payload.deadline,
      originAsset,
      amountIn: body.quote.amountIn,
      amountInFormatted: body.quote.amountInFormatted,
      depositMemo: body.quote.depositMemo,
    });
  }
  const pay =
    !dry && body.quote?.depositAddress && body.quote.amountIn
      ? await paymentCode(
          originAsset,
          body.quote.depositAddress,
          body.quote.amountIn,
          body.quote.depositMemo,
        )
      : null;
  return Response.json(pay ? { ...body, pay } : body, {
    status: response.status,
  });
}

export default defineEventHandler((event) => post(event.req));
