import { contractFor, type Network } from "@/marks/lib/network";

export type PageNotice = { ok: false; title: string; body: string };

export function missingContract(
  network: Network,
  title?: string,
): PageNotice | null {
  if (contractFor(network)) return null;
  return {
    ok: false,
    title:
      title ??
      (network === "mainnet"
        ? "Mainnet has no listing"
        : "No contract configured"),
    body: "Set VITE_CONTRACT_ID to the testnet account that holds Marks v2.",
  };
}

export function failed(title: string, error: unknown): PageNotice {
  return {
    ok: false,
    title,
    body: error instanceof Error ? error.message : "The RPC call failed",
  };
}

/** Chain reads go stale in seconds, so these routes shorten the shared cache. */
export function liveHeaders() {
  return { "x-agent-native-ssr-max-age": "5" };
}
