import { useToast } from "@/marks/components/toast";
import { Pager, TxNote, Row, Spinner } from "@/marks/components/v2-ui";
import { atomsFromDollars, liquidationPrice, money } from "@/marks/lib/format";
import { useNear } from "@/marks/lib/near";
import type { Market, Trader } from "@/marks/lib/rpc";
import {
  paymentPath,
  paymentStanding,
  type PaymentRecord,
} from "@/marks/lib/checkout-request";
import {
  planPayment,
  shareBorrowRoom,
  sourceKey,
  type PaySource,
} from "@/marks/lib/pay-plan";
import { useAction, useOnTraded, useWallet } from "@/marks/lib/use-v2";
import {
  isFresh,
  shareTicker,
  units,
  valueOf,
  viewMarks,
  type Share,
} from "@/marks/lib/v2";
import { useRouter } from "@/marks/lib/navigation";
import { useEffect, useId, useState } from "react";

const ZERO = BigInt(0);
const LINK_PAGE = 5;

function createdLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const STANDING: Record<ReturnType<typeof paymentStanding>, string> = {
  waiting: "Waiting",
  processing: "Processing",
  paid: "Paid",
  failed: "Failed",
  expired: "Expired",
};

/** A vendor sets the amount. The link pays their signed-in account. */
export function PaymentLink() {
  const { account, network, openDialog } = useNear();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [origin, setOrigin] = useState("");
  const [links, setLinks] = useState<PaymentRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [page, setPage] = useState(0);
  const amountId = useId();
  const atoms = atomsFromDollars(amount);

  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    const pull = async () => {
      const response = await fetch(
        `/api/checkout/links?account=${encodeURIComponent(account)}`,
      );
      const body = (await response.json()) as { payments?: PaymentRecord[] };
      if (!cancelled && response.ok && body.payments) setLinks(body.payments);
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [account]);

  const create = async () => {
    if (!account) return openDialog();
    if (!atoms || atoms <= BigInt(0)) return setError("Enter an amount.");
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/checkout/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: amount.trim(), recipient: account }),
      });
      const body = (await response.json()) as {
        payment?: PaymentRecord;
        error?: string;
      };
      if (!response.ok || !body.payment) {
        setError(body.error || "The payment link was not created.");
        return;
      }
      const href = `${origin}${paymentPath(body.payment.id)}`;
      setLinks((current) => [body.payment!, ...current]);
      setPage(0);
      setAmount("");
      await navigator.clipboard.writeText(href).then(
        () => {
          setCopied(body.payment!.id);
          toast.success("Payment link copied.");
        },
        () => toast.info(href),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The link failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!account) {
    return (
      <div className="panel flex justify-center p-5">
        <button type="button" className="btn-gold" onClick={openDialog}>
          Sign in
        </button>
      </div>
    );
  }

  const pageCount = Math.max(1, Math.ceil(links.length / LINK_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleLinks = links.slice(
    currentPage * LINK_PAGE,
    currentPage * LINK_PAGE + LINK_PAGE,
  );

  return (
    <div className="space-y-6">
      <form
        className="panel space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div>
          <label htmlFor={amountId} className="label-mono">
            Amount, USDC
          </label>
          <input
            id={amountId}
            className="field mt-1 font-mono"
            inputMode="decimal"
            autoComplete="off"
            placeholder="40.00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <p className="text-sm text-ink-muted">
          {network === "testnet"
            ? "This link pays your testnet account with Marks. NEAR Intents pays a mainnet account. Sign out, then sign in and choose mainnet."
            : "Whoever opens the link pays this account. The amount is fixed on the link."}
        </p>
        {error ? (
          <p className="text-sm text-gold" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          className="btn-gold"
          disabled={busy || !atoms || atoms <= BigInt(0)}
        >
          {busy ? "Creating" : "Create payment link"}
        </button>
      </form>
      <section className="panel space-y-3 p-5" aria-label="Your payment links">
        <p className="label-mono">Your payment links</p>
        {links.length === 0 ? (
          <p className="text-sm text-ink-muted">No payment links yet.</p>
        ) : (
          <ul className="space-y-3">
            {visibleLinks.map((link) => {
              const href = origin
                ? `${origin}${paymentPath(link.id)}`
                : paymentPath(link.id);
              const standing = paymentStanding(link);
              return (
                <li
                  key={link.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0"
                >
                  <div className="min-w-0">
                    <p className="break-all font-mono text-sm text-ink-muted">
                      {link.id}
                    </p>
                    <p className="font-mono text-lg">{money(link.atoms)}</p>
                    <p className="text-sm text-ink-muted">
                      Created {createdLabel(link.createdAt)}
                    </p>
                    <p
                      className={`text-sm ${
                        standing === "paid"
                          ? "text-ok"
                          : standing === "failed" || standing === "expired"
                            ? "text-error"
                            : standing === "processing"
                              ? "text-gold"
                              : "text-ink-muted"
                      }`}
                    >
                      {STANDING[standing]}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-line text-sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(href).then(
                        () => {
                          setCopied(link.id);
                          toast.success("Payment link copied.");
                        },
                        () => toast.info(href),
                      );
                    }}
                  >
                    {copied === link.id ? "Copied" : "Copy link"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <Pager
          page={currentPage}
          pages={pageCount}
          onPage={setPage}
          label="Payment link pages"
        />
      </section>
    </div>
  );
}

/** The checkout a payment link opens. The amount and merchant are already set. */
export function MarksPay({
  amount,
  merchant,
  paymentId,
  markets,
  shares,
}: {
  amount: string;
  merchant: string;
  paymentId: string;
  markets: Market[];
  shares: Share[];
}) {
  const { account, network, send, openDialog } = useNear();
  const { wallet, loading, refresh } = useWallet();
  const router = useRouter();
  const [sourceId, setSourceId] = useState("balance");
  const [held, setHeld] = useState<{ market: Market; trader: Trader }[] | null>(
    null,
  );
  const [tick, setTick] = useState(0);
  const { busy, hash, error, pulse, run, setError } = useAction();
  useOnTraded(() => setTick((value) => value + 1));

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    void Promise.all(
      markets.map((market) =>
        viewMarks<Trader>(network, "get_trader", {
          symbol: market.symbol,
          account_id: account,
        })
          .then((trader) => ({ market, trader }))
          .catch(() => null),
      ),
    ).then((rows) => {
      if (cancelled) return;
      setHeld(
        rows.filter(
          (row): row is { market: Market; trader: Trader } =>
            row !== null && row.trader.base_lots !== 0,
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [account, markets, network, tick, hash]);

  const bill = atomsFromDollars(amount);
  const balance = BigInt(wallet.balance || "0");
  const choices = choicesFor(shares, wallet, held, balance, bill ?? ZERO);
  const picked = choices.find((choice) => choice.id === sourceId) ?? choices[0];
  const plan =
    bill && picked ? planPayment(bill, balance, picked.source) : null;

  return (
    <div className="space-y-5">
      <CollateralPicker
        account={account}
        loading={loading || (Boolean(account) && !held)}
        choices={choices}
        picked={picked?.id ?? ""}
        onPick={setSourceId}
        onSignIn={openDialog}
      />
      <form
        className="panel space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!account) return openDialog();
          if (!bill || !picked || !plan)
            return setError("This link has no amount.");
          if (plan.error) return setError(planError(plan.error, picked));
          void run("Paying", async () => {
            const tx = await send("pay", {
              merchant,
              amount: bill.toString(),
              source: sourceKey(picked.source),
            });
            void fetch("/api/checkout/paid", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ id: paymentId, hash: tx, account }),
            }).catch(() => undefined);
            refresh();
            router.refresh();
            return tx;
          });
        }}
      >
        <p className="label-mono">Marks balance</p>
        <p className="text-sm text-ink-muted">
          Testnet mUSDC. If your balance is short, the rest is borrowed against
          the position or shares you pick. You keep the asset.
        </p>
        <dl>
          <Row label="Amount" value={bill ? money(bill) : "—"} strong />
          <Row label="Marks balance" value={loading ? "…" : money(balance)} />
          <Row
            label="Borrowed"
            value={
              !plan
                ? "—"
                : plan.error === "balance"
                  ? `${money(plan.shortfall)} needs collateral`
                  : money(plan.shortfall)
            }
          />
          <Row
            label="Loan fee"
            value={
              !plan
                ? "—"
                : plan.error === "balance"
                  ? "1% after you pick collateral"
                  : money(plan.fee)
            }
          />
          {picked?.source.kind === "share" && plan && plan.lock > ZERO ? (
            <Row
              label="Shares locked"
              value={`${units(plan.lock)} ${shareTicker(picked.source.assetId)}`}
            />
          ) : null}
          {picked?.source.kind === "perp" && plan ? (
            <Row label="Debt after" value={money(plan.debtAfter)} />
          ) : null}
          {picked?.source.kind === "perp" && plan ? (
            <Row
              label="Liquidation after"
              value={nextLiquidation(picked, plan.debtAfter)}
            />
          ) : null}
          <Row label="Paid to" value={merchant} />
        </dl>
        {account && plan?.error ? (
          <p className="text-sm text-gold" role="alert">
            {planError(plan.error, picked)}
          </p>
        ) : null}
        <button
          type="submit"
          className="btn-gold w-full"
          disabled={Boolean(busy) || !bill || Boolean(account && plan?.error)}
        >
          {busy ? "Waiting for your wallet" : "Pay with Marks"}
        </button>
        <TxNote hash={hash} error={error} done="Paid." pulse={pulse} />
      </form>
    </div>
  );
}

function CollateralPicker({
  account,
  loading,
  choices,
  picked,
  onPick,
  onSignIn,
}: {
  account: string | null;
  loading: boolean;
  choices: Choice[];
  picked: string;
  onPick: (id: string) => void;
  onSignIn: () => void;
}) {
  if (!account) {
    return (
      <div className="panel space-y-3 p-5">
        <p>
          Sign in to pay from your Marks balance or borrow against a position.
        </p>
        <button type="button" className="btn-gold" onClick={onSignIn}>
          Sign in
        </button>
      </div>
    );
  }
  return (
    <fieldset className="space-y-2">
      <legend className="label-mono">Pay from</legend>
      {loading ? (
        <Spinner />
      ) : (
        choices.map((choice) => (
          <label
            key={choice.id}
            className={`panel flex cursor-pointer items-center justify-between gap-3 p-4 ${picked === choice.id ? "border-gold" : ""}`}
          >
            <span>
              <span className="block font-semibold">{choice.label}</span>
              <span className="block text-xs text-ink-muted">
                Worth {choice.worth}
              </span>
              <span className="block text-xs text-ink-muted">
                {choice.borrow}
              </span>
            </span>
            <input
              type="radio"
              name="source"
              className="size-4"
              checked={picked === choice.id}
              onChange={() => onPick(choice.id)}
            />
          </label>
        ))
      )}
    </fieldset>
  );
}

type Choice = {
  id: string;
  label: string;
  worth: string;
  borrow: string;
  source: PaySource;
  market?: Market;
  trader?: Trader;
};

function choicesFor(
  shares: Share[],
  wallet: {
    balance: string;
    holdings: Record<string, string>;
    loans: Record<string, { units: string; debt: string }>;
  },
  held: { market: Market; trader: Trader }[] | null,
  balance: bigint,
  bill: bigint,
): Choice[] {
  const choices: Choice[] = [
    {
      id: "balance",
      label: "Marks balance",
      worth: money(balance),
      borrow:
        balance >= bill && bill > ZERO
          ? "Ready to pay this amount"
          : `Ready to pay ${money(balance)}`,
      source: { kind: "balance" },
    },
  ];
  for (const row of held ?? []) {
    const limit = BigInt(row.trader.borrow_limit ?? "0");
    const gifted = row.trader.gift_id != null;
    choices.push({
      id: `perp:${row.market.symbol}`,
      label: row.market.symbol,
      worth: money(row.trader.equity ?? row.trader.collateral),
      borrow: gifted ? "In a gift" : `Can borrow ${money(limit)}`,
      source: {
        kind: "perp",
        symbol: row.market.symbol,
        limit,
        debt: BigInt(row.trader.debt ?? "0"),
        giftId: row.trader.gift_id ?? null,
      },
      market: row.market,
      trader: row.trader,
    });
  }
  for (const share of shares) {
    const owned = BigInt(wallet.holdings[share.asset_id] ?? "0");
    const loan = wallet.loans[share.asset_id];
    const locked = BigInt(loan?.units ?? "0");
    if (owned === ZERO && locked === ZERO) continue;
    const price = BigInt(share.price || "0");
    const debt = BigInt(loan?.debt ?? "0");
    const fresh = isFresh(share);
    const room = shareBorrowRoom({ price, owned, locked, debt, fresh });
    choices.push({
      id: `share:${share.asset_id}`,
      label: shareTicker(share.asset_id),
      worth: money(valueOf(owned + locked, price)),
      borrow: room === null ? "Price is stale" : `Can borrow ${money(room)}`,
      source: {
        kind: "share",
        assetId: share.asset_id,
        price,
        owned,
        locked,
        debt,
        fresh,
      },
    });
  }
  return choices;
}

function planError(
  error: NonNullable<ReturnType<typeof planPayment>["error"]>,
  picked?: Choice,
) {
  if (error === "balance")
    return "Your balance is short. Pick a position or shares to borrow the rest.";
  if (error === "gift")
    return "That position is in a gift, so it cannot back this payment until the gift is claimed or refunded.";
  if (error === "limit")
    return "That position cannot borrow enough to cover the rest.";
  if (error === "stale")
    return "That share price is stale. Refresh it on Stocks, then come back.";
  if (error === "shares")
    return `${picked?.label ?? "Those shares"} cannot cover this payment at 50 percent of their value.`;
  return "This payment cannot be made from that asset.";
}

function nextLiquidation(choice: Choice, debt: bigint) {
  if (!choice.market || !choice.trader) return "—";
  const price = liquidationPrice(
    BigInt(choice.trader.collateral) - debt,
    BigInt(choice.trader.base_lots),
    BigInt(choice.trader.entry_quote_per_lot ?? "0"),
    choice.market.maintenance_margin_bps,
  );
  return price === null ? "—" : money(price);
}
