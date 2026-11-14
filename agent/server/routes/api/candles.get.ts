import { defineEventHandler } from "h3";
import { chartCandles, isCandleSpan } from "../../../app/marks/lib/ohlc";

async function get(request: Request) {
  const url = new URL(request.url);
  const asset = url.searchParams.get("asset") ?? "";
  const span = url.searchParams.get("span");
  if (!isCandleSpan(span) || !/^[a-z0-9]{2,8}$/.test(asset)) {
    return Response.json({ error: "Unknown candle size" }, { status: 400 });
  }
  // A live chart polls every few seconds. Every viewer shares one upstream read.
  const live = url.searchParams.get("live") === "1";
  const chart = await chartCandles(asset, [], span, live ? 3_000 : 60_000);
  return Response.json(chart, { headers: { "cache-control": "no-store" } });
}

export default defineEventHandler((event) => get(event.req));
