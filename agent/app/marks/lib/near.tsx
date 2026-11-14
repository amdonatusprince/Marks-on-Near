// Google sign-in loads its SDKs on first use, since they run only in the browser.
const google = () => import("@/marks/lib/google-auth");
import { functionCall } from "near-api-js/lib/transaction";
import { installNightlyRelay, setNightlyNetwork } from "@/marks/lib/nightly";
import {
  NETWORK_COOKIE,
  readStoredNetwork,
  rpcUrl,
  type Network,
} from "@/marks/lib/network";
import { contractId } from "@/marks/lib/rpc-client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "@/marks/lib/navigation";
import type { NearConnector, NearWalletBase } from "@hot-labs/near-connect";

type Choice =
  "google" | "passkey" | "near" | "evm" | "solana" | "stellar" | "ton" | "tron";
type Session = "google" | "wallet" | null;

type NearState = {
  network: Network;
  account: string | null;
  ready: boolean;
  pending: boolean;
  dialogOpen: boolean;
  error: string;
  setNetwork: (network: Network) => Promise<void>;
  openDialog: () => void;
  closeDialog: () => void;
  signIn: (choice: Choice) => Promise<void>;
  signOut: () => Promise<void>;
  send: (
    methodName: string,
    args: object,
    options?: SendOptions,
  ) => Promise<string>;
  sendMany: (calls: ContractCall[]) => Promise<string>;
};

/** One function call inside a transaction. Gas is in gas units, deposit in yoctoNEAR. */
export type ContractCall = {
  methodName: string;
  args: object;
  gas?: string | undefined;
  deposit?: string | undefined;
};

/** Receiver defaults to the Marks contract. Gas in gas units, deposit in yoctoNEAR. */
export type SendOptions = {
  receiverId?: string | undefined;
  gas?: string | undefined;
  deposit?: string | undefined;
};

export const ONE_YOCTO = "1";

/** Ask the connected wallet to sign a NEAR message. The recipient is Marks. */
export async function signMarksMessage(network: Network, message: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const next = await connector(network);
  const wallet = await next.wallet();
  const signed = await wallet.signMessage({
    message,
    recipient: "Marks",
    nonce,
  });
  const asText = (value: unknown) => {
    if (typeof value === "string") return value;
    if (value instanceof Uint8Array) {
      return btoa(String.fromCharCode(...value));
    }
    return String(value);
  };
  return {
    accountId: signed.accountId,
    publicKey: asText(signed.publicKey),
    signature: asText(signed.signature),
    nonce: btoa(String.fromCharCode(...nonce)),
  };
}
export { HEAVY_GAS, ORACLE_FEE } from "@/marks/lib/order-plan";

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
        providers: {
          testnet: [rpcUrl("testnet")],
          mainnet: [rpcUrl("mainnet")],
        },
        footerBranding: {
          heading: "Marks",
          link: "https://near.com",
          linkText: "near.com",
        },
      });
      await next.whenManifestLoaded.catch(() => undefined);
      await next.registerWallet(passkeyManifest).catch(() => undefined);
      return next;
    })();
    connectors.set(network, pending);
  }
  return pending;
}

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : "Could not sign in";
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  work.then(
    () => clearTimeout(timer),
    () => clearTimeout(timer),
  );
  return Promise.race([work, timeout]);
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

  useEffect(() => {
    const saved = readStoredNetwork();
    if (saved !== initialNetwork) setNetworkState(saved);
  }, [initialNetwork]);
  const [account, setAccount] = useState<string | null>(null);
  const [session, setSession] = useState<Session>(null);
  const sessionRef = useRef<Session>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");

  const remember = (next: Session, id: string | null) => {
    sessionRef.current = next;
    setSession(next);
    setAccount(id);
    if (typeof document !== "undefined") {
      if (id) document.documentElement.dataset.marksAccount = id;
      else delete document.documentElement.dataset.marksAccount;
    }
    if (typeof sessionStorage !== "undefined") {
      if (id) sessionStorage.setItem("marks-near-account", id);
      else sessionStorage.removeItem("marks-near-account");
    }
  };

  useEffect(() => {
    setNightlyNetwork(network);
    installNightlyRelay();
    let cancelled = false;
    let current: NearConnector | undefined;
    const onIn = (event: { accounts: { accountId: string }[] }) => {
      if (cancelled || sessionRef.current === "google") return;
      remember("wallet", event.accounts[0]?.accountId ?? null);
    };
    const onOut = () => {
      if (cancelled || sessionRef.current === "google") return;
      remember(null, null);
    };
    void (async () => {
      const next = await connector(network);
      current = next;
      next.on("wallet:signIn", onIn);
      next.on("wallet:signOut", onOut);
      const existing = await next.getConnectedWallet().catch(() => null);
      const walletAccount = existing?.accounts[0]?.accountId ?? null;
      const googleAccount =
        network === "testnet"
          ? await google()
              .then((auth) => auth.restoreGoogleAccount())
              .catch(() => null)
          : null;
      if (cancelled) return;
      if (googleAccount) {
        remember("google", googleAccount);
        void google()
          .then((auth) => auth.ensureGoogleFunded(googleAccount))
          .catch(() => undefined);
      } else remember(walletAccount ? "wallet" : null, walletAccount);
      setReady(true);
    })();
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
      pending,
      dialogOpen,
      error,
      setNetwork: async (next) => {
        if (next === network) return;
        setError("");
        const current = await connector(network);
        await current.disconnect().catch(() => undefined);
        await google()
          .then((auth) => auth.logoutGoogle())
          .catch(() => undefined);
        remember(null, null);
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
        setPending(true);
        try {
          if (choice === "google") {
            if (network !== "testnet") {
              setError(
                "Google sign-in is on testnet. Choose testnet, then continue with Google.",
              );
              return;
            }
            const id = await (await google()).loginGoogle();
            const current = await connector(network);
            await current.disconnect().catch(() => undefined);
            remember("google", id);
            setDialogOpen(false);
            void google()
              .then((auth) => auth.ensureGoogleFunded(id))
              .catch(() => undefined);
            return;
          }
          await google()
            .then((auth) => auth.logoutGoogle())
            .catch(() => undefined);
          remember(null, null);
          const next = await connector(network);
          if (choice === "passkey") await next.connect({ walletId: "passkey" });
          else if (choice === "evm")
            await next.connect({ walletId: "ethereum-wallets" });
          else await next.connect();
          sessionRef.current = "wallet";
          setSession("wallet");
          setDialogOpen(false);
        } catch (caught) {
          if (
            (await google()).googleClosed(caught) ||
            /reject/i.test(messageOf(caught))
          )
            return;
          setError(messageOf(caught));
        } finally {
          setPending(false);
        }
      },
      signOut: async () => {
        const next = await connector(network);
        await next.disconnect().catch(() => undefined);
        await google()
          .then((auth) => auth.logoutGoogle())
          .catch(() => undefined);
        remember(null, null);
      },
      send: async (methodName, args, options = {}) => {
        const id = options.receiverId ?? contractId(network);
        const gas = options.gas ?? "30000000000000";
        const deposit = options.deposit ?? "0";
        if (!id) {
          throw new Error(
            network === "mainnet"
              ? "VITE_MAINNET_CONTRACT_ID is not set"
              : "VITE_CONTRACT_ID is not set",
          );
        }
        if (session === "google") {
          return (await google()).googleSend(
            methodName,
            args,
            id,
            BigInt(gas),
            BigInt(deposit),
          );
        }
        installNightlyRelay();
        const next = await connector(network);
        let wallet: NearWalletBase;
        try {
          wallet = await next.wallet();
        } catch {
          throw new Error("Sign in before sending a transaction");
        }
        const result = await withTimeout(
          wallet.signAndSendTransaction({
            receiverId: id,
            actions: [
              {
                type: "FunctionCall",
                params: { methodName, args, gas, deposit },
              },
            ],
          }),
          120_000,
          "The wallet did not finish sending. Approve the transaction again.",
        );
        return result.transaction?.hash ?? "";
      },
      sendMany: async (calls) => {
        const id = contractId(network);
        if (!id) {
          throw new Error(
            network === "mainnet"
              ? "VITE_MAINNET_CONTRACT_ID is not set"
              : "VITE_CONTRACT_ID is not set",
          );
        }
        if (calls.length === 0)
          throw new Error("The transaction has no actions");
        if (session === "google") {
          return (await google()).googleSendActions(
            id,
            calls.map((call) =>
              functionCall(
                call.methodName,
                call.args,
                BigInt(call.gas ?? "30000000000000"),
                BigInt(call.deposit ?? "0"),
              ),
            ),
          );
        }
        installNightlyRelay();
        const next = await connector(network);
        let wallet: NearWalletBase;
        try {
          wallet = await next.wallet();
        } catch {
          throw new Error("Sign in before sending a transaction");
        }
        const result = await withTimeout(
          wallet.signAndSendTransaction({
            receiverId: id,
            actions: calls.map((call) => ({
              type: "FunctionCall" as const,
              params: {
                methodName: call.methodName,
                args: call.args,
                gas: call.gas ?? "30000000000000",
                deposit: call.deposit ?? "0",
              },
            })),
          }),
          120_000,
          "The wallet did not finish sending. Approve the transaction again.",
        );
        return result.transaction?.hash ?? "";
      },
    }),
    [network, account, ready, pending, dialogOpen, error, session, router],
  );

  return <NearContext.Provider value={value}>{children}</NearContext.Provider>;
}

export function useNear() {
  const value = useContext(NearContext);
  if (!value) throw new Error("useNear must be used inside NearProvider");
  return value;
}
