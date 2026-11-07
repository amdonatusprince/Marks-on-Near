"use client";

import { grouped, price } from "@/lib/format";
import { useNear } from "@/lib/near";
import { viewClient } from "@/lib/rpc-client";
import type { Level } from "@/lib/rpc";
import { useEffect, useState } from "react";

const POLL_MS = 4_000;
const DEPTH = 10;

type BookState = { bids: Level[]; asks: Level[]; mark: number };

export function OrderBook({
  symbol,
  bids,
  asks,
  markTicks,
  tickSize,
  onPick,
}: {
  symbol: string;
  bids: Level[];
  asks: Level[];
  markTicks: number;
  tickSize: string;
  onPick: (side: "bid" | "ask", ticks: number) => void;
}) {
  const { network } = useNear();
  const [book, setBook] = useState<BookState>({ bids, asks, mark: markTicks });

  useEffect(() => {
    setBook({ bids, asks, mark: markTicks });
  }, [bids, asks, markTicks]);

  useEffect(() => {
    let stopped = false;
    let running = false;
    const poll = async () => {
      if (document.hidden || running) return;
      running = true;
      try {
        const [next, market] = await Promise.all([
          viewClient<{ bids: Level[]; asks: Level[] }>(network, "get_l2", {
            symbol,
            depth: DEPTH,
          }),
          viewClient<{ mark_ticks: number }>(network, "get_market", { symbol }),
        ]);
        if (!stopped) setBook({ bids: next.bids, asks: next.asks, mark: market.mark_ticks });
      } catch {
        // The next poll tries again. The book keeps the last good levels.
      } finally {
        running = false;
      }
    };
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [network, symbol]);

  const shownBids = book.bids.slice(0, DEPTH);
  const shownAsks = book.asks.slice(0, DEPTH);
  const bidTotals = cumulative(shownBids, tickSize);
  const askTotals = cumulative(shownAsks, tickSize);
  const deepest = Math.max(1, bidTotals.at(-1) ?? 0, askTotals.at(-1) ?? 0);
  const bestBid = shownBids[0]?.ticks;
  const bestAsk = shownAsks[0]?.ticks;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : null;

  return (
    <section className="flex flex-col rounded-lg border border-border bg-card xl:h-full">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium">Order book</h2>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="marks-live inline-block h-1.5 w-1.5 rounded-full bg-bid" />
          Live
        </span>
      </div>
      <div className="grid shrink-0 grid-cols-3 px-3 py-1.5 text-xs text-muted-foreground">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>
      <div className="flex flex-col justify-end xl:min-h-0 xl:flex-1 xl:overflow-hidden">
        {shownAsks.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">No asks</p>
        ) : null}
        {shownAsks
          .map((level, index) => ({ level, total: askTotals[index] }))
          .reverse()
          .map(({ level, total }) => (
            <LevelRow
              key={`ask-${level.ticks}`}
              level={level}
              side="ask"
              tickSize={tickSize}
              total={total}
              depth={total / deepest}
              onPick={onPick}
            />
          ))}
      </div>
      <p className="flex shrink-0 items-baseline justify-between border-y border-border px-3 py-1.5 font-mono">
        <span className="text-lg tabular-nums">{price(book.mark, tickSize)}</span>
        <span className="text-xs text-muted-foreground">
          {spread != null ? `Spread ${price(spread, tickSize)}` : "Mark"}
        </span>
      </p>
      <div className="flex flex-col xl:min-h-0 xl:flex-1 xl:overflow-hidden">
        {shownBids.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">No bids</p>
        ) : null}
        {shownBids.map((level, index) => (
          <LevelRow
            key={`bid-${level.ticks}`}
            level={level}
            side="bid"
            tickSize={tickSize}
            total={bidTotals[index]}
            depth={bidTotals[index] / deepest}
            onPick={onPick}
          />
        ))}
      </div>
    </section>
  );
}

function cumulative(levels: Level[], tickSize: string) {
  let sum = 0;
  return levels.map((level) => {
    sum += (level.lots * level.ticks * Number(tickSize)) / 1_000_000;
    return sum;
  });
}

function LevelRow({
  level,
  side,
  tickSize,
  total,
  depth,
  onPick,
}: {
  level: Level;
  side: "bid" | "ask";
  tickSize: string;
  total: number;
  depth: number;
  onPick: (side: "bid" | "ask", ticks: number) => void;
}) {
  const tone = side === "bid" ? "text-bid" : "text-ask";
  const wash = side === "bid" ? "bg-bid/15" : "bg-ask/15";
  const [lots, setLots] = useState(level.lots);
  const [flash, setFlash] = useState("");

  useEffect(() => {
    if (level.lots === lots) return;
    setFlash(level.lots > lots ? "marks-flash-up" : "marks-flash-down");
    setLots(level.lots);
  }, [level.lots, lots]);

  return (
    <button
      type="button"
      className={`relative grid h-10 w-full shrink-0 grid-cols-3 items-center px-3 font-mono text-sm tabular-nums hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset xl:h-7 xl:text-xs ${flash}`}
      onAnimationEnd={() => setFlash("")}
      onClick={() => onPick(side, level.ticks)}
      aria-label={`${side === "bid" ? "Bid" : "Ask"} ${grouped(level.lots)} at ${price(level.ticks, tickSize)}. Use this price.`}
    >
      <span
        className={`absolute inset-y-0 right-0 transition-[width] duration-500 ease-out ${wash}`}
        style={{ width: `${Math.max(2, Math.round(depth * 100))}%` }}
        aria-hidden="true"
      />
      <span className={`relative ${tone}`}>{price(level.ticks, tickSize)}</span>
      <span className="relative text-right">{grouped(level.lots)}</span>
      <span className="relative text-right text-muted-foreground">{grouped(total.toFixed(2))}</span>
    </button>
  );
}
