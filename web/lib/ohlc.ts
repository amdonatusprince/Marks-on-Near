export type CandleBar = {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};

export type CandleSpan = "1m" | "15m" | "1h" | "1d";

const SPANS: Record<CandleSpan, { yahoo: string; range: string; note: string }> = {
  "1m": { yahoo: "1m", range: "1d", note: "1 minute candles" },
  "15m": { yahoo: "15m", range: "5d", note: "15 minute candles" },
  "1h": { yahoo: "1h", range: "3mo", note: "1 hour candles" },
  "1d": { yahoo: "1d", range: "2y", note: "1 day candles" },
};

const LISTINGS: Record<string, { id: string; size: number }> = {
  near: { id: "NEAR-USD", size: 1 },
  sol: { id: "SOL-USD", size: 0.5 },
  eth: { id: "ETH-USD", size: 0.01 },
  btc: { id: "BTC-USD", size: 0.001 },
  bnb: { id: "BNB-USD", size: 0.1 },
  xau: { id: "GC=F", size: 0.1 },
  oil: { id: "CL=F", size: 1 },
  nvda: { id: "NVDA", size: 1 },
  aapl: { id: "AAPL", size: 1 },
  tsla: { id: "TSLA", size: 1 },
  msft: { id: "MSFT", size: 1 },
  amzn: { id: "AMZN", size: 1 },
};

const cache = new Map<string, { at: number; candles: CandleBar[]; note: string }>();

export function isCandleSpan(value: string | null): value is CandleSpan {
  return value === "1m" || value === "15m" || value === "1h" || value === "1d";
}

export async function chartCandles(
  assetId: string,
  prints: { time: number; atoms: string }[],
  span: CandleSpan = "15m",
): Promise<{ candles: CandleBar[]; note: string }> {
  const key = `${assetId}:${span}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < 60_000) {
    return { candles: cached.candles, note: cached.note };
  }
  const listing = LISTINGS[assetId];
  const chosen = SPANS[span];
  if (listing) {
    try {
      const candles = await yahooCandles(listing.id, listing.size, chosen.yahoo, chosen.range);
      if (candles.length >= 2) {
        cache.set(key, { at: Date.now(), candles, note: chosen.note });
        return { candles, note: chosen.note };
      }
    } catch {
      // The public feed missed. A 15 minute view can still use the oracle prints.
    }
  }
  if (span === "15m") {
    return { candles: candlesFromPrints(prints), note: "Recent prints from the price feed" };
  }
  return { candles: [], note: `No ${chosen.note} right now` };
}

async function yahooCandles(symbol: string, size: number, interval: string, range: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const body = (await readJson(url)) as {
    chart?: { result?: { timestamp?: number[]; indicators?: { quote?: Quote[] } }[] };
  };
  const result = body.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const stamps = result?.timestamp ?? [];
  if (!quote) return [];
  const candles: CandleBar[] = [];
  const traded: CandleBar[] = [];
  for (let index = 0; index < stamps.length; index += 1) {
    const bar = barFrom(quote, index, stamps[index] * 1000, size);
    if (!bar) continue;
    candles.push(bar);
    if (BigInt(bar.volume) > BigInt(0)) traded.push(bar);
  }
  const chosen = traded.length >= 8 ? traded : candles;
  return chosen.slice(-80);
}

type Quote = {
  open?: (number | null)[];
  high?: (number | null)[];
  low?: (number | null)[];
  close?: (number | null)[];
  volume?: (number | null)[];
};

function barFrom(quote: Quote, index: number, time: number, size: number) {
  return pricesToBar(
    time,
    quote.open?.[index] ?? null,
    quote.high?.[index] ?? null,
    quote.low?.[index] ?? null,
    quote.close?.[index] ?? null,
    quote.volume?.[index] ?? 0,
    size,
  );
}

function pricesToBar(
  time: number,
  open: number | null,
  high: number | null,
  low: number | null,
  close: number | null,
  volume: number | null,
  size: number,
) {
  if (open == null || high == null || low == null || close == null) return null;
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return null;
  return {
    time,
    open: atoms(open, size),
    high: atoms(high, size),
    low: atoms(low, size),
    close: atoms(close, size),
    volume: String(Math.max(0, Math.round(volume ?? 0))),
  };
}

function atoms(price: number, size: number) {
  return BigInt(Math.round(price * size * 1_000_000)).toString();
}

function candlesFromPrints(prints: { time: number; atoms: string }[]) {
  const values = prints.filter((print) => BigInt(print.atoms) > BigInt(0));
  if (values.length === 0) return [];
  const size = Math.max(1, Math.ceil(values.length / 24));
  const candles: CandleBar[] = [];
  for (let index = 0; index < values.length; index += size) {
    const slice = values.slice(index, index + size);
    const prices = slice.map((print) => BigInt(print.atoms));
    const open = prices[0];
    const close = prices[prices.length - 1];
    const high = prices.reduce((max, value) => (value > max ? value : max));
    const low = prices.reduce((min, value) => (value < min ? value : min));
    candles.push({
      time: slice[0].time,
      open: open.toString(),
      high: high.toString(),
      low: low.toString(),
      close: close.toString(),
      volume: "0",
    });
  }
  return candles;
}

async function readJson(url: string) {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "marks-demo-feed/1.0" },
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Price feed returned ${response.status}`);
  return response.json();
}
