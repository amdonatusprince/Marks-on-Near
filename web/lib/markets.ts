const CONTRACT_SIZE: Record<string, string> = {
  "NEAR-PERP": "1 NEAR",
  "SOL-PERP": "0.5 SOL",
  "ETH-PERP": "0.01 ETH",
  "BTC-PERP": "0.001 BTC",
  "BNB-PERP": "0.1 BNB",
  "GOLD-PERP": "0.1 oz of gold",
  "OIL-PERP": "1 barrel of oil",
  "NVDA-PERP": "1 Nvidia share",
  "AAPL-PERP": "1 Apple share",
  "TSLA-PERP": "1 Tesla share",
  "MSFT-PERP": "1 Microsoft share",
  "AMZN-PERP": "1 Amazon share",
};

export function contractSize(symbol: string) {
  return CONTRACT_SIZE[symbol] ?? "";
}
