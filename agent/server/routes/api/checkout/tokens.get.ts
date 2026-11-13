import { defineEventHandler } from "h3";

import { ORIGINS } from "../../../../app/marks/lib/checkout-request";

type Listed = { assetId?: string };

async function get() {
  const response = await fetch("https://1click.chaindefuser.com/v0/tokens");
  if (!response.ok) {
    return Response.json(
      { error: "NEAR Intents did not return its token list." },
      { status: 502 },
    );
  }
  const listed = (await response.json()) as Listed[];
  const live = new Set(
    listed
      .map((token) => token.assetId)
      .filter((id): id is string => Boolean(id)),
  );
  const tokens = ORIGINS.filter((token) => live.has(token.assetId));
  if (tokens.length === 0) {
    return Response.json(
      { error: "None of the checkout tokens are listed on NEAR Intents." },
      { status: 502 },
    );
  }
  return Response.json(
    { tokens },
    { headers: { "cache-control": "no-store" } },
  );
}

export default defineEventHandler(() => get());
