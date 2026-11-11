import { contractFor, rpcUrl, type Network } from "@/marks/lib/network";
import type { Trader } from "@/marks/lib/rpc";

export function contractId(network: Network = "testnet") {
  return contractFor(network);
}

export async function viewClient<T>(
  network: Network,
  method: string,
  args: object,
): Promise<T> {
  const account = contractFor(network);
  if (!account) {
    throw new Error(
      network === "mainnet"
        ? "VITE_MAINNET_CONTRACT_ID is not set"
        : "VITE_CONTRACT_ID is not set",
    );
  }
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
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
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
  return JSON.parse(String.fromCharCode(...bytes)) as T;
}

export type { Trader };
