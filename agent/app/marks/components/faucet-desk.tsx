import { useToast } from "@/marks/components/toast";
import { BalanceStrip, Row, TxNote } from "@/marks/components/v2-ui";
import { atomsFromDollars, money } from "@/marks/lib/format";
import {
  claimFaucetByRelay,
  claimFaucetSelf,
  depositToMarks,
  withdrawFromMarks,
} from "@/marks/lib/desk-writes";
import { useNear } from "@/marks/lib/near";
import { contractFor, tokenFor } from "@/marks/lib/network";
import { useAction, useWallet } from "@/marks/lib/use-v2";
import { useId, useState } from "react";

export function FaucetDesk() {
  const { account, network, openDialog, send } = useNear();
  const { wallet, loading, refresh } = useWallet();
  const claim = useAction();
  const move = useAction();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const id = useId();
  const token = tokenFor(network);
  const contract = contractFor(network);
  const atoms = atomsFromDollars(amount);

  const faucet = () =>
    void claim
      .run(
        "faucet",
        async () =>
          (await claimFaucetByRelay(account ?? "")) ??
          claimFaucetSelf(send, token),
      )
      .then((hash) => hash !== null && refresh());

  return (
    <div className="space-y-6">
      <BalanceStrip wallet={wallet} loading={loading} topUp={false} />
      <ol className="grid gap-5 lg:grid-cols-3">
        <li className="panel flex h-full flex-col gap-4 p-5">
          <p className="label-mono">Step 01</p>
          <h2 className="font-display text-2xl font-semibold">
            Claim 1,000 mUSDC
          </h2>
          <p className="text-sm text-ink-muted">
            Marks mock USDC has six decimals, like USDC. Each account can claim
            once a day. Our relayer pays the gas, so a new Google account works
            at once.
          </p>
          <dl>
            <Row label="Token" value={token || "not set"} />
            <Row label="In your wallet" value={money(wallet.usdc)} />
          </dl>
          <div className="mt-auto space-y-4">
            <button
              type="button"
              className="btn-gold w-full"
              disabled={Boolean(claim.busy)}
              onClick={account ? faucet : openDialog}
            >
              {claim.busy
                ? "Minting"
                : account
                  ? "Claim 1,000 mUSDC"
                  : "Sign in to claim"}
            </button>
            <TxNote
              hash={claim.hash}
              error={claim.error}
              pulse={claim.pulse}
              done="1,000 mUSDC is in your wallet."
            />
          </div>
        </li>

        <li className="panel flex h-full flex-col gap-4 p-5">
          <p className="label-mono">Step 02</p>
          <h2 className="font-display text-2xl font-semibold">
            From any chain
          </h2>
          <p className="text-sm text-ink-muted">
            NEAR Intents is the way in and the way out. Deposit USDC on another
            chain and it arrives on NEAR. Withdraw, and Intents sends it back to
            the chain you choose. You do not bridge it yourself.
          </p>
          <div className="mt-auto space-y-4">
            <button
              type="button"
              className="btn-gold w-full"
              onClick={() =>
                toast.info(
                  "Cross-chain deposit is not live on testnet yet. Claim the mock USDC, then move it into Marks.",
                )
              }
            >
              Deposit from another chain
            </button>
          </div>
        </li>

        <li className="panel flex h-full flex-col gap-4 p-5">
          <p className="label-mono">Step 03</p>
          <h2 className="font-display text-2xl font-semibold">
            Move it into Marks
          </h2>
          <p className="text-sm text-ink-muted">
            Your Marks balance pays for trades, shares, calls, loan repayments
            and gifts. Withdraw sends it back to your wallet.
          </p>
          <div className="mt-auto space-y-4">
            <div
              role="tablist"
              aria-label="Direction"
              className="flex gap-1 rounded-lg border border-line p-1"
            >
              {(
                [
                  ["in", "Deposit"],
                  ["out", "Withdraw"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={direction === value}
                  onClick={() => setDirection(value)}
                  className={`min-h-10 flex-1 rounded-md px-3 text-sm font-semibold ${direction === value ? "bg-gold text-bg" : "text-ink-muted hover:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!account) return openDialog();
                if (!atoms)
                  return move.setError("Enter an amount, such as 500.");
                const limit = BigInt(
                  direction === "in" ? wallet.usdc : wallet.balance,
                );
                if (atoms > limit) {
                  return move.setError(
                    direction === "in"
                      ? "Your wallet holds less than that."
                      : "Your Marks balance is less than that.",
                  );
                }
                void move
                  .run(direction, () =>
                    direction === "in"
                      ? depositToMarks(send, token, contract, atoms)
                      : withdrawFromMarks(send, atoms),
                  )
                  .then((hash) => {
                    if (hash !== null) {
                      setAmount("");
                      refresh();
                    }
                  });
              }}
            >
              <div className="flex items-baseline justify-between">
                <label htmlFor={id} className="label-mono">
                  {direction === "in" ? "Deposit USDC" : "Withdraw USDC"}
                </label>
                <button
                  type="button"
                  className="text-xs text-gold underline-offset-4 hover:underline"
                  onClick={() =>
                    setAmount(
                      (
                        Number(
                          direction === "in" ? wallet.usdc : wallet.balance,
                        ) / 1e6
                      ).toFixed(2),
                    )
                  }
                >
                  All {money(direction === "in" ? wallet.usdc : wallet.balance)}
                </button>
              </div>
              <input
                id={id}
                className="field font-mono"
                inputMode="decimal"
                autoComplete="off"
                placeholder="500"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <button
                type="submit"
                className="btn-gold w-full"
                disabled={Boolean(move.busy)}
              >
                {move.busy
                  ? "Sending"
                  : direction === "in"
                    ? "Deposit into Marks"
                    : "Withdraw to my wallet"}
              </button>
              <TxNote
                hash={move.hash}
                error={move.error}
                pulse={move.pulse}
                done={direction === "in" ? "Deposited." : "Withdrawn."}
              />
            </form>
          </div>
        </li>
      </ol>
    </div>
  );
}
