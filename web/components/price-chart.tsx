"use client";

import { money } from "@/lib/format";
import type { CandleBar, CandleSpan } from "@/lib/ohlc";
import { useEffect, useState } from "react";

const SPANS: { id: CandleSpan; label: string }[] = [
  { id: "1m", label: "1m" },
  { id: "15m", label: "15m" },
  { id: "1h", label: "1h" },
  { id: "1d", label: "1D" },
];

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
  const [series, setSeries] = useState(candles);
  const [label, setLabel] = useState(note);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSpan("15m");
    setSeries(candles);
    setLabel(note);
    setError("");
  }, [assetId, candles, note]);

  async function choose(next: CandleSpan) {
    if (next === span) return;
    setSpan(next);
    setPending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/candles?asset=${encodeURIComponent(assetId)}&span=${next}`,
      );
      if (!response.ok) throw new Error("The candles could not be loaded");
      const body = (await response.json()) as { candles?: CandleBar[]; note?: string };
      if (!Array.isArray(body.candles)) throw new Error("The candles could not be loaded");
      setSeries(body.candles);
      setLabel(body.note ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The candles could not be loaded");
    } finally {
      setPending(false);
    }
  }

  const latest = series.at(-1);
  const first = series[0];
  const change = latest && first ? BigInt(latest.close) - BigInt(first.open) : BigInt(0);
  const rose = change >= BigInt(0);
  const percent =
    first && BigInt(first.open) > BigInt(0) ? (Number(change) / Number(first.open)) * 100 : 0;
  return (
    <section
      className="flex flex-col rounded-lg border border-border bg-card md:min-h-0 md:flex-1"
      aria-busy={pending}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
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
                className={`h-10 min-w-10 rounded px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${span === item.id ? "bg-muted font-medium" : "text-muted-foreground"}`}
                onClick={() => void choose(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {latest ? (
          <p className={`font-mono text-sm ${rose ? "text-bid" : "text-ask"}`}>
            <span className="marks-live mr-2 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle" />
            {money(latest.close)}
            <span className="ml-2">
              {rose ? "+" : ""}
              {percent.toFixed(2)}%
            </span>
          </p>
        ) : (
          <p className="font-mono text-sm text-muted-foreground">Waiting for a print</p>
        )}
      </div>
      {series.length === 0 ? (
        <p className="px-4 py-8 text-sm text-muted-foreground">
          {label || "No prints yet. The feed writes a price, then the candles appear here."}
        </p>
      ) : (
        <div className={`flex flex-col md:min-h-0 md:flex-1 ${pending ? "opacity-60" : ""}`}>
          <Chart
            key={`${span}-${series[0].time}-${series.length}`}
            candles={series}
            note={label}
            rose={rose}
          />
        </div>
      )}
      {error ? <p className="px-4 pb-3 text-sm text-destructive">{error}</p> : null}
    </section>
  );
}

function Chart({ candles, note, rose }: { candles: CandleBar[]; note: string; rose: boolean }) {
  const width = 720;
  const height = 300;
  const padX = 10;
  const plotTop = 14;
  const plotBottom = 214;
  const volTop = 226;
  const volBottom = 286;
  const highs = candles.map((candle) => BigInt(candle.high));
  const lows = candles.map((candle) => BigInt(candle.low));
  const peak = highs.reduce((max, value) => (value > max ? value : max));
  const floor = lows.reduce((min, value) => (value < min ? value : min));
  const span = peak - floor;
  const cushion = span / BigInt(12) > BigInt(0) ? span / BigInt(12) : BigInt(1);
  const top = peak + cushion;
  const bottom = floor > cushion ? floor - cushion : BigInt(0);
  const slot = (width - padX * 2) / candles.length;
  const bodyWidth = Math.min(7, Math.max(2.4, slot * 0.62));
  const volumes = candles.map((candle) => BigInt(candle.volume));
  const maxVolume = volumes.reduce((max, value) => (value > max ? value : max), BigInt(0));
  const showVolume = maxVolume > BigInt(0);
  const yOf = (atoms: bigint) => {
    const range = top - bottom;
    if (range <= BigInt(0)) return (plotTop + plotBottom) / 2;
    const plot = plotBottom - plotTop;
    return plotTop + Number(((top - atoms) * BigInt(plot)) / range);
  };
  const last = candles[candles.length - 1];
  const lastY = yOf(BigInt(last.close));
  const stagger = candles.length <= 1 ? 0 : 280 / (candles.length - 1);
  return (
    <div className="flex flex-col px-2 py-3 md:min-h-0 md:flex-1">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${candles.length} ${note}. The last candle closed ${rose ? "higher" : "lower"} at ${money(last.close)}.`}
        className="h-72 w-full md:h-0 md:min-h-40 md:flex-1"
      >
        {[0, 1, 2, 3].map((row) => {
          const y = plotTop + ((plotBottom - plotTop) * row) / 3;
          return (
            <line
              key={row}
              x1={padX}
              x2={width - padX}
              y1={y}
              y2={y}
              strokeWidth="1"
              className="stroke-border"
            />
          );
        })}
        <line
          x1={padX}
          x2={width - padX}
          y1={lastY}
          y2={lastY}
          strokeWidth="1"
          strokeDasharray="3 4"
          className={rose ? "stroke-bid" : "stroke-ask"}
        />
        {candles.map((candle, index) => {
          const up = BigInt(candle.close) >= BigInt(candle.open);
          const x = padX + index * slot + (slot - bodyWidth) / 2;
          const center = x + bodyWidth / 2;
          let bodyY = Math.min(yOf(BigInt(candle.open)), yOf(BigInt(candle.close)));
          let bodyHeight = Math.abs(yOf(BigInt(candle.close)) - yOf(BigInt(candle.open)));
          if (bodyHeight < 1.6) {
            bodyY -= (1.6 - bodyHeight) / 2;
            bodyHeight = 1.6;
          }
          const delay = `${Math.round(index * stagger)}ms`;
          const tone = up ? "fill-bid" : "fill-ask";
          const vol = BigInt(candle.volume);
          const volHeight =
            maxVolume > BigInt(0) ? Number((vol * BigInt(volBottom - volTop)) / maxVolume) : 0;
          return (
            <g key={candle.time}>
              <title>
                {`${money(candle.open)} to ${money(candle.close)}, high ${money(candle.high)}, low ${money(candle.low)}`}
              </title>
              <g className="marks-candle" style={{ animationDelay: delay }}>
                <line
                  x1={center}
                  x2={center}
                  y1={yOf(BigInt(candle.high))}
                  y2={yOf(BigInt(candle.low))}
                  strokeWidth="1.15"
                  className={up ? "stroke-bid" : "stroke-ask"}
                />
                <rect
                  x={x}
                  y={bodyY}
                  width={bodyWidth}
                  height={bodyHeight}
                  rx="0.6"
                  className={tone}
                />
              </g>
              {showVolume ? (
                <rect
                  x={x}
                  y={volBottom - volHeight}
                  width={bodyWidth}
                  height={Math.max(volHeight, 0)}
                  className={`marks-volume ${tone}`}
                  opacity="0.45"
                  style={{ animationDelay: delay }}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <p className="px-2 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
