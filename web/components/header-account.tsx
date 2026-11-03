"use client";

import { useNear } from "@/lib/near";

export function HeaderAccount() {
  const { account, ready, openDialog, signOut } = useNear();
  if (!ready) {
    return <span className="h-10 w-24 rounded-md bg-muted" aria-hidden="true" />;
  }
  if (!account) {
    return (
      <button
        type="button"
        className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        onClick={openDialog}
      >
        Sign in
      </button>
    );
  }
  const short = account.length > 22 ? `${account.slice(0, 10)}…${account.slice(-6)}` : account;
  return (
    <div className="flex items-center gap-2">
      <p className="max-w-40 truncate font-mono text-xs" title={account}>
        {short}
      </p>
      <button
        type="button"
        className="h-10 rounded-md border border-border px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        onClick={() => void signOut()}
      >
        Sign out
      </button>
    </div>
  );
}
