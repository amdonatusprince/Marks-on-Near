import { ChainIcon } from "@/marks/components/chain-icon";
import { useNotify } from "@/marks/components/toast";
import { useNear } from "@/marks/lib/near";
import { useEffect, useId, useRef } from "react";

const chains = [
  { id: "near", label: "NEAR Wallets" },
  { id: "evm", label: "EVM Wallets" },
  { id: "solana", label: "Solana Wallets" },
  { id: "stellar", label: "Stellar Wallets" },
  { id: "ton", label: "TON Wallets" },
  { id: "tron", label: "Tron" },
] as const;

export function SignInDialog() {
  const {
    dialogOpen,
    closeDialog,
    signIn,
    error,
    network,
    setNetwork,
    pending,
  } = useNear();
  const titleId = useId();
  const passkeyRef = useRef<HTMLButtonElement>(null);
  useNotify(error);

  useEffect(() => {
    if (!dialogOpen) return;
    passkeyRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen, closeDialog]);

  if (!dialogOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close sign in"
        onClick={closeDialog}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl"
      >
        <h2 id={titleId} className="text-xl font-semibold tracking-tight">
          Sign in or create an account
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Use a passkey, a Google account, or connect a wallet.
        </p>
        <div
          className="mt-4 grid grid-cols-2 gap-2"
          role="group"
          aria-label="Network"
        >
          {(
            [
              ["mainnet", "Mainnet"],
              ["testnet", "Testnet"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={network === id}
              disabled={pending}
              className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-60 ${
                network === id
                  ? "border-ring bg-muted"
                  : "border-border bg-background"
              }`}
              onClick={() => void setNetwork(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {network === "mainnet"
            ? "Wallets sign in on NEAR mainnet. A payment link pays this account."
            : "Wallets sign in on NEAR testnet. Marks trades use mock USDC."}
        </p>
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            Wondering which to choose?
          </summary>
          <p className="mt-2 text-muted-foreground">
            A passkey uses Touch ID or Face ID, the same sign-in as near.com.
            Google opens NEAR Auth on testnet and derives an account from that
            login. NEAR and EVM wallets sign on {network}. Solana, Stellar, TON,
            and Tron open the NEAR wallet list, because the order is a NEAR
            transaction.
          </p>
        </details>
        <button
          ref={passkeyRef}
          type="button"
          className="mt-5 flex w-full items-center gap-3 rounded-lg border border-border bg-muted px-4 py-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          disabled={pending}
          onClick={() => void signIn("passkey")}
        >
          <Fingerprint />
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="font-medium">
                Passkey for Touch ID and Face ID
              </span>
              <span className="shrink-0 rounded-full bg-bid px-2 py-0.5 text-xs font-medium text-bid-foreground">
                Recommended
              </span>
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Use your device biometrics or passcode to sign in.
            </span>
          </span>
        </button>
        <button
          type="button"
          disabled={pending}
          className="mt-3 flex w-full items-center gap-3 rounded-lg border border-border bg-background px-4 py-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-60"
          onClick={() => void signIn("google")}
        >
          <GoogleMark />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Continue with Google</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              {pending
                ? "Opening NEAR Auth…"
                : network === "mainnet"
                  ? "Google sign-in is on testnet. Switch above to use it."
                  : "Sign in through NEAR Auth on testnet."}
            </span>
          </span>
        </button>
        <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          Web3 wallets
          <span className="h-px flex-1 bg-border" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {chains.map((chain) => (
            <button
              key={chain.id}
              type="button"
              disabled={pending}
              className="flex min-h-16 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-60"
              onClick={() => void signIn(chain.id)}
            >
              <ChainIcon id={chain.id} />
              {chain.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 48 48"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-1 2.9-3.1 5.2-5.9 6.5l.1.1 6.2 5.2C38.2 37.3 44 32 44 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}

function Fingerprint() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
      className="shrink-0 text-bid"
    >
      <path d="M12 11a3 3 0 0 0-3 3c0 2 1 4 1 6" />
      <path d="M12 11a3 3 0 0 1 3 3c0 1.2-.3 2.3-.7 3.3" />
      <path d="M8.5 8.5a5 5 0 0 1 8.2 1.2c.6 1.4.8 3 .6 4.6" />
      <path d="M7 7a7 7 0 0 1 11.2 2.2c1 2.4 1.2 5 .6 7.3" />
      <path d="M12 11v1" />
    </svg>
  );
}
