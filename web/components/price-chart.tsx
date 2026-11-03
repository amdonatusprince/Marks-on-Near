"use client";

import { useNotify } from "@/components/toast";
import { money } from "@/lib/format";
import { SPAN_SECONDS, streamFor, type CandleBar, type CandleSpan } from "@/lib/ohlc";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useRef, useState } from "react";

const SPANS: { id: CandleSpan; label: string }[] = [
  { id: "1m", label: "1m" },
  { id: "15m", label: "15m" },
  { id: "1h", label: "1h" },
  { id: "1d", label: "1D" },
];

const POLL_MS = 4_000;
const VISIBLE_BARS = 120;

type Quote = { open: string; close: string; move: "up" | "down" | null; tick: number };

export function PriceChart({
  assetId,
  candles,
  note,
}: {
  assetId: string;
  candles: CandleBar[];
  note: string;
}) {
  const [span, setSpan] = useState<CandleSpan>("15m");
  const [label, setLabel] = useState(note);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useNotify(error);
  const [empty, setEmpty] = useState(candles.length === 0);
  const [quote, setQuote] = useState<Quote | null>(quoteOf(candles, null, 0));
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const bars = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const last = useRef<Row | null>(null);
  const streaming = useRef(false);
  const colors = useRef({ up: "#3fb8a6", down: "#c46a86" });

  const retick = useCallback((close: number) => {
    const atoms = String(Math.round(close * 1_000_000));
    setQuote((previous) => {
      if (!previous || previous.close === atoms) return previous;
      const move = BigInt(atoms) > BigInt(previous.close) ? "up" : "down";
      return { open: previous.open, close: atoms, move, tick: previous.tick + 1 };
    });
  }, []);

  const show = useCallback((next: CandleBar[]) => {
    const series = bars.current;
    if (!series || !volume.current || !chart.current) return;
    const rows = toRows(next);
    series.setData(rows.map(candleOf));
    volume.current.setData(rows.map((row) => volumeBar(row, colors.current)));
    last.current = rows.at(-1) ?? null;
    setEmpty(rows.length === 0);
    setQuote((previous) => quoteOf(next, null, (previous?.tick ?? 0) + 1));
    if (rows.length > 0) {
      chart.current.timeScale().setVisibleLogicalRange({
        from: Math.max(0, rows.length - VISIBLE_BARS),
        to: rows.length + 4,
      });
    }
  }, []);

  const put = useCallback((row: Row) => {
    bars.current?.update(candleOf(row));
    volume.current?.update(volumeBar(row, colors.current));
    last.current = row;
  }, []);

  const merge = useCallback(
    (next: CandleBar[]) => {
      for (const row of toRows(next)) {
        const current = last.current;
        if (current && row.time < current.time) continue;
        if (streaming.current && current && row.time === current.time) {
          // The stream's last trade is newer than the polled close.
          put({
            ...row,
            open: current.open,
            close: current.close,
            high: Math.max(row.high, current.high),
            low: Math.min(row.low, current.low),
          });
        } else {
          put(row);
        }
      }
      if (!streaming.current && last.current) retick(last.current.close);
    },
    [put, retick],
  );

  const trade = useCallback(
    (close: number, seconds: number, bucket: number) => {
      const current = last.current;
      if (!current) return;
      const time = (Math.floor(seconds / bucket) * bucket) as UTCTimestamp;
      if (time < current.time) return;
      put(
        time === current.time
          ? {
              ...current,
              close,
              high: Math.max(current.high, close),
              low: Math.min(current.low, close),
            }
          : { time, open: current.close, high: close, low: close, close, volume: 0 },
      );
      retick(close);
    },
    [put, retick],
  );

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const style = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;
    colors.current = { up: read("--ok", "#3fb8a6"), down: read("--error", "#c46a86") };
    const line = read("--line", "rgba(246,239,230,0.08)");
    const created = createChart(element, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: read("--ink-muted", "#b9aea4"),
        fontFamily: read("--font-mono", "ui-monospace, monospace"),
        fontSize: 11,
      },
      grid: {
        vertLines: { color: line, style: LineStyle.Solid },
        horzLines: { color: line, style: LineStyle.Solid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: read("--gold", "#f2b13d"), labelBackgroundColor: "#2a1a1d" },
        horzLine: { color: read("--gold", "#f2b13d"), labelBackgroundColor: "#2a1a1d" },
      },
      rightPriceScale: { borderColor: line, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: {
        borderColor: line,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 7,
      },
    });
    bars.current = created.addSeries(CandlestickSeries, {
      upColor: colors.current.up,
      downColor: colors.current.down,
      wickUpColor: colors.current.up,
      wickDownColor: colors.current.down,
      borderVisible: false,
      priceLineStyle: LineStyle.Dashed,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    volume.current = created.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volume.current.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.current = created;
    return () => {
      created.remove();
      chart.current = null;
      bars.current = null;
      volume.current = null;
    };
  }, []);

  useEffect(() => {
    setSpan("15m");
    setLabel(note);
    setError("");
    show(candles);
  }, [assetId, candles, note, show]);

  useEffect(() => {
    let stopped = false;
    let running: AbortController | null = null;
    const poll = async () => {
      if (document.hidden || running) return;
      running = new AbortController();
      try {
        const body = await readCandles(assetId, span, true, running.signal);
        if (!stopped && body.candles.length > 0) merge(body.candles.slice(-3));
      } catch {
        // The next poll tries again. The chart keeps the last good candles.
      } finally {
        running = null;
      }
    };
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      stopped = true;
      running?.abort();
      window.clearInterval(timer);
    };
  }, [assetId, span, merge]);

  useEffect(() => {
    const stream = streamFor(assetId);
    if (!stream) return;
    const bucket = SPAN_SECONDS[span];
    let socket: WebSocket | null = null;
    let closed = false;
    let retries = 0;
    let retryTimer = 0;
    let frame = 0;
    let pending: { close: number; seconds: number } | null = null;
    const flush = () => {
      frame = 0;
      if (pending) trade(pending.close, pending.seconds, bucket);
      pending = null;
    };
    const connect = () => {
      socket = new WebSocket("wss://ws-feed.exchange.coinbase.com");
      socket.onopen = () => {
        retries = 0;
        socket?.send(
          JSON.stringify({
            type: "subscribe",
            product_ids: [stream.product],
            channels: ["ticker"],
          }),
        );
      };
      socket.onmessage = (event) => {
        let message: { type?: string; price?: string; time?: string };
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (message.type !== "ticker" || !message.price) return;
        streaming.current = true;
        const at = message.time ? Date.parse(message.time) : Date.now();
        pending = { close: Number(message.price) * stream.size, seconds: at / 1000 };
        if (!frame) frame = requestAnimationFrame(flush);
      };
      socket.onclose = () => {
        streaming.current = false;
        if (closed) return;
        retries += 1;
        retryTimer = window.setTimeout(connect, Math.min(30_000, 1_000 * 2 ** retries));
      };
    };
    connect();
    return () => {
      closed = true;
      streaming.current = false;
      window.clearTimeout(retryTimer);
      cancelAnimationFrame(frame);
      socket?.close();
    };
  }, [assetId, span, trade]);

  async function choose(next: CandleSpan) {
    if (next === span) return;
    setSpan(next);
    setPending(true);
    setError("");
    try {
      const body = await readCandles(assetId, next, false);
      setLabel(body.note);
      show(body.candles);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The candles could not be loaded");
    } finally {
      setPending(false);
    }
  }

  const change = quote ? BigInt(quote.close) - BigInt(quote.open) : BigInt(0);
  const rose = change >= BigInt(0);
  const percent =
    quote && BigInt(quote.open) > BigInt(0) ? (Number(change) / Number(quote.open)) * 100 : 0;
  const flash =
    quote?.move === "up" ? "marks-flash-up" : quote?.move === "down" ? "marks-flash-down" : "";

  return (
    <section
      className="flex h-[22rem] flex-col rounded-lg border border-border bg-card md:h-[28rem] xl:h-full xl:min-h-0"
      aria-busy={pending}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-medium">Price</h2>
          <div
            role="group"
            aria-label="Candle size"
            className="flex rounded-md border border-border p-0.5"
          >
            {SPANS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={span === item.id}
                className={`h-9 min-w-10 rounded px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${span === item.id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => void choose(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {quote ? (
          <p
            className={`font-mono text-sm tabular-nums ${rose ? "text-bid" : "text-ask"}`}
            aria-live="polite"
          >
            <span className="marks-live mr-2 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle" />
            <span key={quote.tick} className={`rounded px-1 ${flash}`}>
              {money(quote.close)}
            </span>
            <span className="ml-2">
              {rose ? "+" : ""}
              {percent.toFixed(2)}%
            </span>
          </p>
        ) : (
          <p className="font-mono text-sm text-muted-foreground">Waiting for a print</p>
        )}
      </div>
      <div
        className={`relative min-h-0 flex-1 transition-opacity duration-200 ${pending ? "opacity-50" : "marks-chart-in"}`}
      >
        <div
          ref={host}
          className="absolute inset-0"
          role="img"
          aria-label={
            quote
              ? `${label}. Last price ${money(quote.close)}, ${rose ? "up" : "down"} ${Math.abs(percent).toFixed(2)} percent over the chart.`
              : label
          }
        />
        {empty ? (
          <p className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-muted-foreground">
            {label || "No prints yet. The feed writes a price, then the candles appear here."}
          </p>
        ) : null}
      </div>
      <p className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span>{label}</span>
        <span>
          {streamFor(assetId) ? "Live trades from Coinbase" : `Live, every ${POLL_MS / 1000}s`}
        </span>
      </p>
    </section>
  );
}

type Row = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function toRows(candles: CandleBar[]): Row[] {
  const byTime = new Map<number, Row>();
  for (const candle of candles) {
    const time = Math.floor(candle.time / 1000) as UTCTimestamp;
    byTime.set(time, {
      time,
      open: dollars(candle.open),
      high: dollars(candle.high),
      low: dollars(candle.low),
      close: dollars(candle.close),
      volume: Number(candle.volume),
    });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function candleOf(row: Row) {
  return { time: row.time, open: row.open, high: row.high, low: row.low, close: row.close };
}

function volumeBar(row: Row, colors: { up: string; down: string }) {
  const tone = row.close >= row.open ? colors.up : colors.down;
  return { time: row.time, value: row.volume, color: withAlpha(tone, 0.4) };
}

function dollars(atoms: string) {
  return Number(atoms) / 1_000_000;
}

function withAlpha(hex: string, alpha: number) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = Number.parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function quoteOf(candles: CandleBar[], previous: Quote | null, tick: number): Quote | null {
  const first = candles[0];
  const last = candles.at(-1);
  if (!first || !last) return null;
  const open = previous?.open ?? first.open;
  const move =
    previous && previous.close !== last.close
      ? BigInt(last.close) > BigInt(previous.close)
        ? "up"
        : "down"
      : null;
  return { open, close: last.close, move, tick };
}

async function readCandles(assetId: string, span: CandleSpan, live: boolean, signal?: AbortSignal) {
  const response = await fetch(
    `/api/candles?asset=${encodeURIComponent(assetId)}&span=${span}${live ? "&live=1" : ""}`,
    { signal, cache: "no-store" },
  );
  if (!response.ok) throw new Error("The candles could not be loaded");
  const body = (await response.json()) as { candles?: CandleBar[]; note?: string };
  if (!Array.isArray(body.candles)) throw new Error("The candles could not be loaded");
  return { candles: body.candles, note: body.note ?? "" };
}
