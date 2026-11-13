import { defineEventHandler } from "h3";

import { markIntent, paymentIdOk } from "../../../marks/payments";

async function get(request: Request) {
  const params = new URL(request.url).searchParams;
  const depositAddress = params.get("depositAddress") ?? "";
  const id = params.get("id") ?? "";
  if (
    depositAddress.length < 8 ||
    depositAddress.length > 180 ||
    /\s/.test(depositAddress)
  ) {
    return Response.json(
      { error: "Missing deposit address." },
      { status: 400 },
    );
  }
  const response = await fetch(
    `https://1click.chaindefuser.com/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`,
  );
  const body = (await response.json().catch(() => ({
    error: "Status failed",
  }))) as { status?: string };
  if (response.ok && body.status && paymentIdOk(id)) {
    await markIntent(id, depositAddress, body.status);
  }
  return Response.json(body, {
    status: response.status,
    headers: { "cache-control": "no-store" },
  });
}

export default defineEventHandler((event) => get(event.req));
