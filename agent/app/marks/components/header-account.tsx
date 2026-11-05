import { useNear } from "@/marks/lib/near";

export function HeaderAccount({ compact = true }: { compact?: boolean }) {
  const { account, ready, openDialog, signOut } = useNear();
  if (!ready) {
    return (
      <span className="h-10 w-20 rounded-lg bg-muted" aria-hidden="true" />
    );
  }
  if (!account) {
    return (
      <button
        type="button"
        className="btn-gold min-h-10 px-4 py-2 text-sm"
        onClick={openDialog}
      >
        Sign in
      </button>
    );
  }
  const short =
    account.length > 18
      ? `${account.slice(0, 7)}…${account.slice(-6)}`
      : account;
  return (
    <div className="flex items-center gap-2">
      <p
        className={
          compact
            ? "hidden max-w-36 truncate font-mono text-xs text-ink-muted sm:block"
            : "max-w-full truncate font-mono text-xs text-ink-muted"
        }
        title={account}
      >
        {short}
      </p>
      <button
        type="button"
        className="btn-line min-h-10 px-3 py-2 text-sm"
        onClick={() => void signOut()}
        title={account}
      >
        Sign out
      </button>
    </div>
  );
}
