import { contractFor, rpcUrl, type Network } from "@/lib/network";

export type Market = {
  symbol: string;
  category: string;
  tick_size: string;
  initial_margin_bps: number;
  maintenance_margin_bps: number;
  max_funding_bps: number;
  mark_ticks: number;
  index_ticks: number;
  insurance: string;
  open_interest_lots: number;
  volume_quote: string;
  funding_index: string;
  funding_interval_ns: string;
  bad_debt: string;
  asset_id: string;
  mark_updated_ns: string;
};

export type Level = { ticks: number; lots: number };

export type Book = { bids: Level[]; asks: Level[] };

export type Trader = {
  collateral: string;
  base_lots: number;
  free_collateral: string;
  unallocated: string;
  open_bid_lots: number;
  open_ask_lots: number;
  liquidation_quote_per_lot?: string | null;
  entry_quote_per_lot?: string;
  equity?: string;
  unrealized_pnl?: string;
  debt?: string;
  borrow_limit?: string;
  gift_id?: number | null;
};

export function contractId(network: Network = "testnet") {
  return contractFor(network);
}

export async function view<T>(network: Network, method: string, args: object): Promise<T> {
  const account = contractFor(network);
  if (!account) {
    throw new Error(
      network === "mainnet"
        ? "NEXT_PUBLIC_MAINNET_CONTRACT_ID is not set"
        : "NEXT_PUBLIC_CONTRACT_ID is not set",
    );
  }
  return viewAccount<T>(network, account, method, args);
}

export async function viewAccount<T>(
  network: Network,
  account: string,
  method: string,
  args: object,
): Promise<T> {
  const response = await fetch(rpcUrl(network), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "marks",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: account,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`RPC returned ${response.status}`);
  }
  const body = (await response.json()) as {
    error?: { message?: string };
    result?: { result?: number[] };
  };
  if (body.error) {
    throw new Error(body.error.message ?? "RPC error");
  }
  const bytes = body.result?.result;
  if (!bytes) {
    throw new Error("RPC returned no result");
  }
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as T;
}
