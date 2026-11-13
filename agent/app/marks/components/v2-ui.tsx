import { notifyOnce, useToast } from "@/marks/components/toast";
import { money } from "@/marks/lib/format";
import { useNear } from "@/marks/lib/near";
import type { Wallet } from "@/marks/lib/use-v2";
import { explorerTx } from "@/marks/lib/v2";
import Link from "@/marks/components/link";
import { useEffect, useRef } from "react";

/** Previous and next for a short list. Hidden when everything fits on one page. */
export function Pager({
  page,
  pages,
  onPage,
  label,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
  label: string;
}) {
  if (pages <= 1) return null;
  return (
    <nav
      className="flex items-center justify-between gap-3 pt-3"
      aria-label={label}
    >
      <button
        type="button"
        className="btn-line text-sm"
        disabled={page <= 0}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </button>
      <p className="text-sm text-ink-muted tabular-nums">
        {page + 1} of {pages}
      </p>
      <button
        type="button"
        className="btn-line text-sm"
        disabled={page >= pages - 1}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}

/** Page wait, centered on the screen. The label is for screen readers only. */
export function Spinner() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center"
      role="status"
    >
      <span className="marks-spin" aria-hidden />
      <span className="sr-only">Loading</span>
    </div>
  );
}

/** Wallet mUSDC and the Marks balance. `topUp` links to the faucet; the faucet page hides it. */
export function BalanceStrip({
  wallet,
  loading,
  topUp = true,
}: {
  wallet: Wallet;
  loading: boolean;
  topUp?: boolean;
}) {
  const { account, openDialog } = useNear();
  if (!account) {
    return (
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm text-ink-muted">
          Sign in with Google or a NEAR wallet to trade, borrow and send gifts.
        </p>
        <button type="button" className="btn-gold text-sm" onClick={openDialog}>
          Sign in
        </button>
      </div>
    );
  }
  return (
    <div
      className={`panel grid gap-4 p-4 sm:items-center ${topUp ? "sm:grid-cols-[1fr_1fr_auto]" : "sm:grid-cols-2"}`}
    >
      <Stat
        label="In your wallet"
        value={loading ? "…" : money(wallet.usdc)}
        hint="mUSDC on NEAR, outside Marks"
      />
      <Stat
        label="Marks balance"
        value={loading ? "…" : money(wallet.balance)}
        hint="Ready to trade, buy, repay or gift"
      />
      {topUp ? (
        <Link href="/faucet" className="btn-line text-sm">
          Faucet and deposit
        </Link>
      ) : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="label-mono">{label}</p>
      <p className="mt-1 truncate font-mono text-lg">{value}</p>
      {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

/** Sends the last action's outcome to the toast stack. Renders nothing on the card. */
export function TxNote({
  hash,
  error,
  done,
  pulse = 0,
}: {
  hash: string;
  error: string;
  done?: string;
  pulse?: number;
}) {
  const toast = useToast();
  const seen = useRef("");
  useEffect(() => {
    if (!error && !hash) {
      seen.current = "";
      return;
    }
    const key = `${pulse}|${error}|${hash}|${done ?? ""}`;
    if (key === seen.current) return;
    seen.current = key;
    if (!notifyOnce(key)) return;
    if (error) toast.error(error);
    else
      toast.success(done ?? "Done.", {
        href: explorerTx(hash),
        label: "View the transaction",
      });
  }, [hash, error, done, pulse, toast]);
  return null;
}

export function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={`text-right font-mono ${strong ? "text-gold" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-1 rounded-lg border border-line p-1"
    >
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={`min-h-10 flex-1 whitespace-nowrap rounded-md px-3 text-sm font-semibold transition-colors ${
            value === id ? "bg-gold text-bg" : "text-ink-muted hover:text-ink"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
