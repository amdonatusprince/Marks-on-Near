"use client";

import { AccountPanel } from "@/components/account-panel";
import { OrderBook } from "@/components/order-book";
import { OrderTicket } from "@/components/order-ticket";
import { PriceChart } from "@/components/price-chart";
import { fundingWords, money, openInterest, price as priceOf } from "@/lib/format";
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
    <div className="grid gap-3 md:h-[calc(100dvh-5.75rem)] md:grid-cols-[minmax(0,1fr)_22rem] md:grid-rows-[minmax(0,1fr)]">
      <div className="flex flex-col gap-3 md:h-full md:min-h-0">
        <header className="grid shrink-0 gap-x-6 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 md:grid-cols-[auto_auto_minmax(0,1fr)] md:items-end">
          <div>
            <Link
              href="/"
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
            <p className="text-xs text-muted-foreground">Price</p>
            <p className="font-mono text-3xl">{priceOf(market.mark_ticks, market.tick_size)}</p>
          </div>
          <dl className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Funding</dt>
              <dd>{fundingWords(fundingBps)}</dd>
              <dd className="text-xs text-muted-foreground">
                {fundingBps === 0
                  ? "Price matches the index, so nobody pays."
                  : "Paid every few seconds on testnet."}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Open interest</dt>
              <dd className="font-mono">
                {openInterest(market.open_interest_lots, market.mark_ticks, market.tick_size)}
              </dd>
              <dd className="text-xs text-muted-foreground">
                {market.open_interest_lots}{" "}
                {market.open_interest_lots === 1 ? "contract" : "contracts"} open
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Traded</dt>
              <dd className="font-mono">{money(market.volume_quote)}</dd>
            </div>
          </dl>
        </header>
        <PriceChart assetId={market.asset_id} candles={history} note={chartNote} />
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
      <div className="md:h-full md:min-h-0 md:overflow-y-auto">
        <OrderTicket
          symbol={market.symbol}
          markTicks={market.mark_ticks}
          tickSize={market.tick_size}
          price={price}
          side={side}
          maintenanceBps={market.maintenance_margin_bps}
          onPrice={setPrice}
          onSide={setSide}
        />
      </div>
    </div>
  );
}
