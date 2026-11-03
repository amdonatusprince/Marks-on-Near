"use client";

import { ChainIcon } from "@/components/chain-icon";
import { useNear } from "@/lib/near";
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
  const { dialogOpen, closeDialog, signIn, error, network } = useNear();
  const titleId = useId();
  const passkeyRef = useRef<HTMLButtonElement>(null);

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
          Use a passkey for the easiest experience, or connect a wallet.
        </p>
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            Wondering which to choose?
          </summary>
          <p className="mt-2 text-muted-foreground">
            A passkey uses Touch ID or Face ID, the same sign-in as near.com. NEAR and EVM wallets
            sign on {network}. Solana, Stellar, TON, and Tron open the NEAR wallet list, because the
            order is a NEAR transaction.
          </p>
        </details>
        <button
          ref={passkeyRef}
          type="button"
          className="mt-5 flex w-full items-center gap-3 rounded-lg border border-border bg-muted px-4 py-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          onClick={() => void signIn("passkey")}
        >
          <Fingerprint />
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="font-medium">Passkey for Touch ID and Face ID</span>
              <span className="shrink-0 rounded-full bg-bid px-2 py-0.5 text-xs font-medium text-bid-foreground">
                Recommended
              </span>
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Use your device biometrics or passcode to sign in.
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
              className="flex min-h-16 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              onClick={() => void signIn(chain.id)}
            >
              <ChainIcon id={chain.id} />
              {chain.label}
            </button>
          ))}
        </div>
        {error ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
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
