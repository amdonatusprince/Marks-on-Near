"use client";

import { price } from "@/lib/format";
import type { Level } from "@/lib/rpc";

export function OrderBook({
  bids,
  asks,
  markTicks,
  tickSize,
  onPick,
}: {
  bids: Level[];
  asks: Level[];
  markTicks: number;
  tickSize: string;
  onPick: (side: "bid" | "ask", ticks: number) => void;
}) {
  const max = Math.max(1, ...bids.map((level) => level.lots), ...asks.map((level) => level.lots));
  const askRows = [...asks].reverse();
  return (
    <section className="flex shrink-0 flex-col rounded-lg border border-border bg-card">
      <h2 className="border-b border-border px-4 py-3 text-sm font-medium">Order book</h2>
      <div className="grid grid-cols-3 px-4 py-2 text-xs text-muted-foreground">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>
      <div className="flex flex-col">
        {askRows.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No asks</p>
        ) : null}
        {askRows.map((level, index) => (
          <LevelRow
            key={`ask-${level.ticks}`}
            level={level}
            side="ask"
            tickSize={tickSize}
            max={max}
            total={running(askRows.slice(index), tickSize)}
            onPick={onPick}
          />
        ))}
      </div>
      <p className="border-y border-border px-4 py-2 font-mono text-lg">
        <span className="mr-2 text-xs text-muted-foreground">Price</span>
        {price(markTicks, tickSize)}
      </p>
      <div>
        {bids.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No bids</p>
        ) : null}
        {bids.map((level, index) => (
          <LevelRow
            key={`bid-${level.ticks}`}
            level={level}
            side="bid"
            tickSize={tickSize}
            max={max}
            total={running(bids.slice(0, index + 1), tickSize)}
            onPick={onPick}
          />
        ))}
      </div>
    </section>
  );
}

function running(levels: Level[], tickSize: string) {
  const atoms = levels.reduce(
    (sum, level) => sum + BigInt(level.lots) * BigInt(level.ticks) * BigInt(tickSize),
    BigInt(0),
  );
  const whole = atoms / BigInt(1000000);
  const frac = (atoms % BigInt(1000000)).toString().padStart(2, "0").slice(0, 2);
  return `${whole}.${frac}`;
}

function LevelRow({
  level,
  side,
  tickSize,
  max,
  total,
  onPick,
}: {
  level: Level;
  side: "bid" | "ask";
  tickSize: string;
  max: number;
  total: string;
  onPick: (side: "bid" | "ask", ticks: number) => void;
}) {
  const width = `${Math.max(4, Math.round((level.lots / max) * 100))}%`;
  const tone = side === "bid" ? "text-bid" : "text-ask";
  const wash = side === "bid" ? "bg-bid/15" : "bg-ask/15";
  return (
    <button
      type="button"
      className="relative grid h-10 w-full grid-cols-3 items-center px-4 font-mono text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      onClick={() => onPick(side, level.ticks)}
    >
      <span className={`absolute inset-y-0 right-0 ${wash}`} style={{ width }} aria-hidden="true" />
      <span className={`relative ${tone}`}>{price(level.ticks, tickSize)}</span>
      <span className="relative text-right">{level.lots}</span>
      <span className="relative text-right text-muted-foreground">{total}</span>
    </button>
  );
}
