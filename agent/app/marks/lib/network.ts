export type Network = "testnet" | "mainnet";

export const NETWORK_COOKIE = "marks-network";

const env = import.meta.env;

// Page HTML and loader data are one shared CDN copy for every visitor, so
// loaders read this network and the visitor's choice applies after hydration.
export const SERVED_NETWORK: Network = "testnet";

export function rpcUrl(network: Network) {
  if (network === "mainnet") return "https://rpc.mainnet.near.org";
  return env.VITE_TESTNET_RPC || "https://test.rpc.fastnear.com";
}

export function contractFor(network: Network) {
  if (network === "mainnet") return env.VITE_MAINNET_CONTRACT_ID ?? "";
  return env.VITE_CONTRACT_ID || "marks2-6e889d.testnet";
}

export function tokenFor(network: Network) {
  if (network === "mainnet") return "";
  return env.VITE_TOKEN_ID || "musdc-6e889d.testnet";
}

export function oracleFor(network: Network) {
  if (network === "mainnet") return "";
  return env.VITE_ORACLE_ID || "oracle2-6e889d.testnet";
}

export function intentsRecipient() {
  return env.VITE_INTENTS_RECIPIENT || "marks.near";
}
