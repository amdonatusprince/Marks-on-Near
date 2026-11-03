"use client";

import { NETWORK_COOKIE, type Network } from "@/lib/network";
import { contractId } from "@/lib/rpc-client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { NearConnector, NearWalletBase } from "@hot-labs/near-connect";

type Choice = "passkey" | "near" | "evm" | "solana" | "stellar" | "ton" | "tron";

type NearState = {
  network: Network;
  account: string | null;
  ready: boolean;
  dialogOpen: boolean;
  error: string;
  setNetwork: (network: Network) => Promise<void>;
  openDialog: () => void;
  closeDialog: () => void;
  signIn: (choice: Choice) => Promise<void>;
  signOut: () => Promise<void>;
  send: (methodName: string, args: object) => Promise<string>;
};

const NearContext = createContext<NearState | null>(null);

const passkeyManifest = {
  id: "passkey",
  name: "Passkey",
  description: "Touch ID and Face ID",
  icon: "https://near.com/favicon.ico",
  website: "https://near.com",
  version: "1.0.0",
  executor:
    "https://raw.githubusercontent.com/NEAR-DevHub/near-connect-passkey/master/passkey-executor.js",
  type: "sandbox" as const,
  platform: ["browser"],
  permissions: { storage: true },
  features: {
    signMessage: true,
    signTransaction: true,
    signAndSendTransaction: true,
    signAndSendTransactions: true,
    signInWithoutAddKey: true,
    signInAndSignMessage: false,
    signInWithFunctionCallKey: false,
    signDelegateActions: true,
    mainnet: true,
    testnet: true,
  },
};

const connectors = new Map<Network, Promise<NearConnector>>();

function connector(network: Network) {
  let pending = connectors.get(network);
  if (!pending) {
    pending = (async () => {
      const { NearConnector } = await import("@hot-labs/near-connect");
      const next = new NearConnector({
        network,
        footerBranding: { heading: "Marks", link: "https://near.com", linkText: "near.com" },
      });
      await next.whenManifestLoaded.catch(() => undefined);
      await next.registerWallet(passkeyManifest).catch(() => undefined);
      return next;
    })();
    connectors.set(network, pending);
  }
  return pending;
}

export function NearProvider({
  initialNetwork,
  children,
}: {
  initialNetwork: Network;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [network, setNetworkState] = useState<Network>(initialNetwork);
  const [account, setAccount] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let current: NearConnector | undefined;
    const onIn = (event: { accounts: { accountId: string }[] }) => {
      if (!cancelled) setAccount(event.accounts[0]?.accountId ?? null);
    };
    const onOut = () => {
      if (!cancelled) setAccount(null);
    };
    void connector(network).then(async (next) => {
      current = next;
      next.on("wallet:signIn", onIn);
      next.on("wallet:signOut", onOut);
      const existing = await next.getConnectedWallet().catch(() => null);
      if (!cancelled) {
        setAccount(existing?.accounts[0]?.accountId ?? null);
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
      current?.off("wallet:signIn", onIn);
      current?.off("wallet:signOut", onOut);
    };
  }, [network]);

  const value = useMemo<NearState>(
    () => ({
      network,
      account,
      ready,
      dialogOpen,
      error,
      setNetwork: async (next) => {
        if (next === network) return;
        setDialogOpen(false);
        setError("");
        const current = await connector(network);
        await current.disconnect().catch(() => undefined);
        setAccount(null);
        document.cookie = `${NETWORK_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
        setNetworkState(next);
        router.refresh();
      },
      openDialog: () => {
        setError("");
        setDialogOpen(true);
      },
      closeDialog: () => setDialogOpen(false),
      signIn: async (choice) => {
        setError("");
        const next = await connector(network);
        try {
          if (choice === "passkey") await next.connect({ walletId: "passkey" });
          else if (choice === "evm") await next.connect({ walletId: "ethereum-wallets" });
          else await next.connect();
          setDialogOpen(false);
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : "Could not sign in";
          if (/reject/i.test(message)) return;
          setError(message);
        }
      },
      signOut: async () => {
        const next = await connector(network);
        await next.disconnect().catch(() => undefined);
        setAccount(null);
      },
      send: async (methodName, args) => {
        const next = await connector(network);
        let wallet: NearWalletBase;
        try {
          wallet = await next.wallet();
        } catch {
          throw new Error("Sign in before sending a transaction");
        }
        const id = contractId(network);
        if (!id)
          throw new Error(
            network === "mainnet"
              ? "NEXT_PUBLIC_MAINNET_CONTRACT_ID is not set"
              : "NEXT_PUBLIC_CONTRACT_ID is not set",
          );
        const result = await wallet.signAndSendTransaction({
          receiverId: id,
          actions: [
            {
              type: "FunctionCall",
              params: {
                methodName,
                args,
                gas: "30000000000000",
                deposit: "0",
              },
            },
          ],
        });
        return result.transaction?.hash ?? "";
      },
    }),
    [network, account, ready, dialogOpen, error, router],
  );

  return <NearContext.Provider value={value}>{children}</NearContext.Provider>;
}

export function useNear() {
  const value = useContext(NearContext);
  if (!value) throw new Error("useNear must be used inside NearProvider");
  return value;
}
