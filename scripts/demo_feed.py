#!/usr/bin/env python3
"""Fetch public prices and write one set_series payload per demo market.

The stored price is the dollar price of one contract, not the full coin.
A contract is a slice of the asset so about 300 USDC lands on a whole number
of contracts. This script never fills in a price it did not receive.
"""

import json
import sys
import time
import urllib.parse
import urllib.request
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

DECIMALS = 8
LIMIT = 24
USER_AGENT = "marks-demo-feed/1.0"

MARKETS = [
    {"asset_id": "near", "symbol": "NEAR-PERP", "size": "1", "source": "coingecko", "id": "near"},
    {"asset_id": "sol", "symbol": "SOL-PERP", "size": "0.5", "source": "coingecko", "id": "solana"},
    {"asset_id": "eth", "symbol": "ETH-PERP", "size": "0.01", "source": "coingecko", "id": "ethereum"},
    {"asset_id": "btc", "symbol": "BTC-PERP", "size": "0.001", "source": "coingecko", "id": "bitcoin"},
    {"asset_id": "bnb", "symbol": "BNB-PERP", "size": "0.1", "source": "coingecko", "id": "binancecoin"},
    {"asset_id": "xau", "symbol": "GOLD-PERP", "size": "0.1", "source": "yahoo", "id": "GC=F"},
    {"asset_id": "oil", "symbol": "OIL-PERP", "size": "1", "source": "yahoo", "id": "CL=F"},
    {"asset_id": "nvda", "symbol": "NVDA-PERP", "size": "1", "source": "yahoo", "id": "NVDA"},
    {"asset_id": "aapl", "symbol": "AAPL-PERP", "size": "1", "source": "yahoo", "id": "AAPL"},
    {"asset_id": "tsla", "symbol": "TSLA-PERP", "size": "1", "source": "yahoo", "id": "TSLA"},
    {"asset_id": "msft", "symbol": "MSFT-PERP", "size": "1", "source": "yahoo", "id": "MSFT"},
    {"asset_id": "amzn", "symbol": "AMZN-PERP", "size": "1", "source": "yahoo", "id": "AMZN"},
]


def fetch(url: str) -> object:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    last_error = "no response"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except Exception as error:  # noqa: BLE001 - the next attempt is the recovery
            last_error = str(error)
            time.sleep(2 + attempt * 3)
    raise RuntimeError(last_error)


def thin(points: list[tuple[int, Decimal]]) -> list[tuple[int, Decimal]]:
    if len(points) <= LIMIT:
        return points
    step = (len(points) - 1) / (LIMIT - 1)
    return [points[round(index * step)] for index in range(LIMIT)]


def coingecko(coin: str) -> list[tuple[int, Decimal]]:
    url = f"https://api.coingecko.com/api/v3/coins/{coin}/market_chart?vs_currency=usd&days=1"
    body = fetch(url)
    rows = body.get("prices") if isinstance(body, dict) else None
    if not isinstance(rows, list) or not rows:
        raise RuntimeError("CoinGecko returned no prices")
    points = []
    for row in rows:
        if not isinstance(row, list) or len(row) < 2:
            continue
        price = Decimal(str(row[1]))
        if price > 0:
            points.append((int(row[0]), price))
    if not points:
        raise RuntimeError("CoinGecko returned no positive prices")
    return points


def yahoo(symbol: str) -> list[tuple[int, Decimal]]:
    quoted = urllib.parse.quote(symbol, safe="")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{quoted}?interval=30m&range=5d"
    body = fetch(url)
    try:
        result = body["chart"]["result"][0]
        stamps = result["timestamp"]
        closes = result["indicators"]["quote"][0]["close"]
    except (KeyError, IndexError, TypeError) as error:
        raise RuntimeError("Yahoo returned no chart") from error
    points = []
    for stamp, close in zip(stamps, closes):
        if close is None:
            continue
        price = Decimal(str(close))
        if price > 0:
            points.append((int(stamp) * 1000, price))
    if not points:
        raise RuntimeError("Yahoo returned no positive prices")
    return points


def multiplier(price: Decimal, size: Decimal) -> str:
    scaled = (price * size * (Decimal(10) ** DECIMALS)).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    if scaled <= 0:
        raise RuntimeError("contract price rounded to zero")
    return str(int(scaled))


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: demo_feed.py <output-dir>", file=sys.stderr)
        sys.exit(1)
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for market in MARKETS:
        size = Decimal(market["size"])
        try:
            if market["source"] == "coingecko":
                spots = coingecko(market["id"])
                time.sleep(2)
            else:
                spots = yahoo(market["id"])
        except Exception as error:  # noqa: BLE001 - fail this asset, do not invent a price
            print(f"{market['symbol']}: {error}", file=sys.stderr)
            sys.exit(1)
        spots = thin(spots)
        points = [
            {
                "timestamp_ms": stamp,
                "multiplier": multiplier(price, size),
                "decimals": DECIMALS,
            }
            for stamp, price in spots
        ]
        payload = {"asset_id": market["asset_id"], "points": points}
        path = out / f"{market['asset_id']}.json"
        path.write_text(json.dumps(payload))
        last = Decimal(points[-1]["multiplier"]) / (Decimal(10) ** DECIMALS)
        whole = int(Decimal(300) / last)
        print(f"{market['symbol']} {market['asset_id']}: ${last} per contract, {whole} contracts in 300 USDC")


if __name__ == "__main__":
    main()
