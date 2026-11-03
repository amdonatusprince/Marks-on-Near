export type Network = "testnet" | "mainnet";

export const NETWORK_COOKIE = "marks-network";

export function parseNetwork(value: string | undefined | null): Network {
  return value === "mainnet" ? "mainnet" : "testnet";
}

export function rpcUrl(network: Network) {
  if (network === "mainnet") return "https://rpc.mainnet.near.org";
  return process.env.NEXT_PUBLIC_TESTNET_RPC || "https://test.rpc.fastnear.com";
}

export function contractFor(network: Network) {
  if (network === "mainnet") return process.env.NEXT_PUBLIC_MAINNET_CONTRACT_ID ?? "";
  return process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";
}

export function tokenFor(network: Network) {
  if (network === "mainnet") return "";
  return process.env.NEXT_PUBLIC_TOKEN_ID ?? "";
}

export function oracleFor(network: Network) {
  if (network === "mainnet") return "";
  return process.env.NEXT_PUBLIC_ORACLE_ID ?? "";
}
