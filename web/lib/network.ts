export type Network = "testnet" | "mainnet";

export const NETWORK_COOKIE = "marks-network";

export function parseNetwork(value: string | undefined | null): Network {
  return value === "mainnet" ? "mainnet" : "testnet";
}

export function rpcUrl(network: Network) {
  return network === "mainnet" ? "https://rpc.mainnet.near.org" : "https://rpc.testnet.near.org";
}

export function contractFor(network: Network) {
  if (network === "mainnet") return process.env.NEXT_PUBLIC_MAINNET_CONTRACT_ID ?? "";
  return process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";
}
