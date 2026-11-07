"use client";

import { AccountPanel } from "@/components/account-panel";
import { OrderBook } from "@/components/order-book";
import { OrderTicket } from "@/components/order-ticket";
import { PriceChart } from "@/components/price-chart";
import { fundingWords, grouped, money, openInterest, price as priceOf } from "@/lib/format";
import { contractSize } from "@/lib/markets";
import type { CandleBar } from "@/lib/ohlc";
import type { Book, Market } from "@/lib/rpc";
import Link from "next/link";
import { useState } from "react";

export function TradeDesk({
  market,
  book,
  fundingBps,
  history,
  chartNote,
}: {
  market: Market;
  book: Book;
  fundingBps: number;
  history: CandleBar[];
  chartNote: string;
}) {
  const [price, setPrice] = useState(String(market.mark_ticks || ""));
  const [side, setSide] = useState<"bid" | "ask">("bid");
  const unit = contractSize(market.symbol);

  return (
    <div className="desk">
      <header className="desk-head flex flex-wrap items-end gap-x-8 gap-y-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="min-w-0">
          <Link
            href="/markets"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Markets
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{market.symbol}</h1>
          <p className="text-xs text-muted-foreground">
            {market.category}
            {unit ? ` · 1 contract = ${unit}` : " · one contract is priced in USDC"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Mark</p>
          <p className="font-mono text-3xl tabular-nums">
            {priceOf(market.mark_ticks, market.tick_size)}
          </p>
        </div>
        <dl className="grid min-w-[16rem] flex-1 grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Funding</dt>
            <dd>{fundingWords(fundingBps)}</dd>
            <dd className="text-xs text-muted-foreground">
              {fundingBps === 0 ? "Mark matches the index." : "Settled each hour."}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Open interest</dt>
            <dd className="font-mono tabular-nums">
              {openInterest(market.open_interest_lots, market.mark_ticks, market.tick_size)}
            </dd>
            <dd className="text-xs text-muted-foreground">
              {grouped(market.open_interest_lots)}{" "}
              {market.open_interest_lots === 1 ? "contract" : "contracts"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Traded</dt>
            <dd className="font-mono tabular-nums">{money(market.volume_quote)}</dd>
          </div>
        </dl>
      </header>
      <div className="desk-chart">
        <PriceChart assetId={market.asset_id} candles={history} note={chartNote} />
      </div>
      <div className="desk-book">
        <OrderBook
          symbol={market.symbol}
          bids={book.bids}
          asks={book.asks}
          markTicks={market.mark_ticks}
          tickSize={market.tick_size}
          onPick={(nextSide, ticks) => {
            setSide(nextSide);
            setPrice(String(ticks));
          }}
        />
      </div>
      <div className="desk-ticket">
        <OrderTicket
          symbol={market.symbol}
          markTicks={market.mark_ticks}
          tickSize={market.tick_size}
          price={price}
          side={side}
          maintenanceBps={market.maintenance_margin_bps}
          initialMarginBps={market.initial_margin_bps}
          onPrice={setPrice}
          onSide={setSide}
        />
      </div>
      <div className="desk-account">
        <AccountPanel symbol={market.symbol} />
      </div>
    </div>
  );
}
