"use client";

import { AccountPanel } from "@/components/account-panel";
import { OrderBook } from "@/components/order-book";
import { OrderTicket } from "@/components/order-ticket";
import { dollars, quote } from "@/lib/format";
import type { Book, Market } from "@/lib/rpc";
import Link from "next/link";
import { useState } from "react";

export function TradeDesk({
  market,
  book,
  fundingBps,
}: {
  market: Market;
  book: Book;
  fundingBps: number;
}) {
  const [price, setPrice] = useState(String(market.mark_ticks || ""));
  const [side, setSide] = useState<"bid" | "ask">("bid");

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="order-2 grid gap-3 lg:order-1">
        <header className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <div>
            <Link
              href="/"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Markets
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">{market.symbol}</h1>
            <p className="text-xs text-muted-foreground">
              {market.category} · {market.asset_id}
            </p>
          </div>
          <p className="font-mono text-3xl">{dollars(market.mark_ticks, market.tick_size)}</p>
          <dl className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Funding</dt>
              <dd className="font-mono">{fundingBps} bps</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Open interest</dt>
              <dd className="font-mono">{market.open_interest_lots}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Volume</dt>
              <dd className="font-mono">{quote(market.volume_quote)}</dd>
            </div>
          </dl>
        </header>
        <OrderBook
          bids={book.bids}
          asks={book.asks}
          markTicks={market.mark_ticks}
          tickSize={market.tick_size}
          onPick={(nextSide, ticks) => {
            setSide(nextSide);
            setPrice(String(ticks));
          }}
        />
        <AccountPanel symbol={market.symbol} />
      </div>
      <div className="order-1 lg:sticky lg:top-3 lg:order-2 lg:self-start">
        <OrderTicket
          symbol={market.symbol}
          markTicks={market.mark_ticks}
          tickSize={market.tick_size}
          price={price}
          side={side}
          onPrice={setPrice}
          onSide={setSide}
        />
      </div>
    </div>
  );
}
