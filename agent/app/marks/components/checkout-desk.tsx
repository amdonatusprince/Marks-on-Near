import { useToast } from "@/marks/components/toast";
import { MarksPay } from "@/marks/components/pay-desk";
import { Row, Spinner, Tabs } from "@/marks/components/v2-ui";
import {
  ORIGINS,
  formatToken,
  invoiceAtoms,
  nearAccount,
  refundAddress,
  type OriginToken,
  type PaymentIntent,
  type PaymentRecord,
} from "@/marks/lib/checkout-request";
import { money } from "@/marks/lib/format";
import { useNear } from "@/marks/lib/near";
import type { Market } from "@/marks/lib/rpc";
import type { Share } from "@/marks/lib/v2";
import Link from "@/marks/components/link";
import { IconChevronDown } from "@tabler/icons-react";
import { useEffect, useId, useRef, useState } from "react";

const STATUSES: Record<string, string> = {
  PENDING_DEPOSIT: "Waiting for your transfer.",
  KNOWN_DEPOSIT_TX: "The deposit is in. Solvers are picking it up.",
  PROCESSING: "NEAR Intents is settling the payment.",
  SUCCESS: "Paid. The merchant has the USDC.",
  INCOMPLETE_DEPOSIT: "The transfer was short, so it will be refunded.",
  REFUNDED: "The payment was refunded to your address.",
  FAILED: "The payment failed. Funds go back to your refund address.",
};

type QuoteBody = {
  quote?: {
    amountIn?: string | undefined;
    amountInFormatted?: string | undefined;
    amountOutFormatted?: string | undefined;
    depositAddress?: string | undefined;
    depositMemo?: string | null | undefined;
  };
  quoteRequest?: { deadline?: string | undefined };
  pay?: { wallets: string; image: string } | null | undefined;
  message?: string | undefined;
  error?: string | undefined;
};

export function CheckoutDesk({
  markets,
  shares,
  payment,
  intent = null,
}: {
  markets: Market[];
  shares: Share[];
  payment: PaymentRecord;
  intent?: PaymentIntent | null;
}) {
  const { account, network } = useNear();
  const amount = payment.amount;
  const recipient = nearAccount(payment.recipient) ?? "";
  const order = payment.id;
  const atoms = invoiceAtoms(amount);
  const [rail, setRail] = useState<"marks" | "intents">("marks");
  const [refundTo, setRefundTo] = useState("");
  const [tokens, setTokens] = useState<OriginToken[]>(ORIGINS);
  const [assetId, setAssetId] = useState(ORIGINS[0]?.assetId ?? "");
  const [originAsset, setOriginAsset] = useState(intent?.originAsset ?? "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [quote, setQuote] = useState<QuoteBody["quote"] | null>(
    intent?.depositAddress
      ? {
          amountIn: intent.amountIn,
          amountInFormatted: intent.amountInFormatted,
          depositAddress: intent.depositAddress,
          depositMemo: intent.depositMemo,
        }
      : null,
  );
  const [expiresAt, setExpiresAt] = useState<string | null>(
    intent?.expiresAt ?? payment.expiresAt ?? null,
  );
  const [scan, setScan] = useState<{ wallets: string; image: string } | null>(
    intent?.pay?.image ? intent.pay : null,
  );
  const [status, setStatus] = useState(
    intent?.depositAddress ? "PENDING_DEPOSIT" : "",
  );
  const toast = useToast();
  const refundId = useId();
  const tokenId = useId();
  const token = tokens.find((item) => item.assetId === assetId) ?? tokens[0];

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/checkout/tokens")
      .then(async (response) => {
        const body = (await response.json()) as { tokens?: OriginToken[] };
        if (!response.ok || !body.tokens?.length || cancelled) return;
        setTokens(body.tokens);
        setAssetId((current) =>
          body.tokens?.some((item) => item.assetId === current)
            ? current
            : (body.tokens?.[0]?.assetId ?? current),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const depositAddress = quote?.depositAddress;
    if (!depositAddress) return;
    let cancelled = false;
    const pull = async () => {
      const response = await fetch(
        `/api/checkout/status?depositAddress=${encodeURIComponent(depositAddress)}&id=${encodeURIComponent(payment.id)}`,
      );
      const body = (await response.json()) as { status?: string };
      if (cancelled || !body.status) return;
      setStatus(body.status);
      if (body.status === "SUCCESS" && window.opener) {
        window.opener.postMessage(
          {
            source: "marks-checkout",
            order,
            status: body.status,
            depositAddress,
          },
          "*",
        );
      }
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [order, payment.id, quote?.depositAddress]);

  const remaining = useRemaining(expiresAt);

  if (payment.status === "paid") {
    return (
      <div className="panel mx-auto max-w-xl space-y-2 p-5">
        <p className="label-mono text-ok">Paid</p>
        <p className="font-mono text-3xl">{money(payment.atoms)}</p>
        <p className="text-sm text-ink-muted">
          This payment link is already paid to{" "}
          <span className="font-mono text-ink">{recipient}</span>.
        </p>
      </div>
    );
  }

  if (!atoms || !recipient) {
    return (
      <div className="panel mx-auto max-w-xl space-y-3 p-5">
        <p>This payment link is not valid.</p>
        <Link href="/pay" className="btn-gold text-sm">
          Create a payment link
        </Link>
      </div>
    );
  }

  const requestQuote = async (dry: boolean) => {
    setError("");
    setStatus("");
    const refund = refundAddress(refundTo);
    if (!refund)
      return setError("Enter the address that will send the payment.");
    if (!token) return setError("Pick the token you will send.");
    setBusy(dry ? "Quoting" : "Opening");
    if (!dry) {
      setQuote(null);
      setExpiresAt(null);
      setScan(null);
    }
    try {
      const response = await fetch("/api/checkout/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dry,
          originAsset: token.assetId,
          paymentId: payment.id,
          refundTo: refund,
        }),
      });
      const body = (await response.json()) as QuoteBody;
      if (!response.ok || !body.quote?.amountIn) {
        setError(
          body.message || body.error || "NEAR Intents refused this quote.",
        );
        return;
      }
      if (dry) {
        toast.success(
          `Sending ${body.quote.amountInFormatted ?? formatToken(body.quote.amountIn, token.decimals)} ${token.symbol} delivers ${body.quote.amountOutFormatted ?? amount} USDC.`,
        );
        return;
      }
      if (!body.quote.depositAddress) {
        setError("The quote did not include a deposit address.");
        return;
      }
      setQuote(body.quote);
      setExpiresAt(body.quoteRequest?.deadline ?? null);
      setOriginAsset(token.assetId);
      setScan(body.pay?.image ? body.pay : null);
      setStatus("PENDING_DEPOSIT");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The quote failed.");
    } finally {
      setBusy("");
    }
  };

  const done =
    status === "SUCCESS" || status === "REFUNDED" || status === "FAILED";
  const quoted = Boolean(expiresAt);
  const expired = quoted && remaining === 0 && status !== "SUCCESS";
  const payToken = tokens.find((item) => item.assetId === originAsset) ?? token;

  if (expired) {
    return (
      <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center px-4">
        <div className="panel w-full max-w-xl space-y-2 p-5 text-center">
          <p className="label-mono text-gold">Contact the vendor</p>
          <p>This payment link has expired.</p>
        </div>
      </div>
    );
  }

  if (quote?.depositAddress) {
    return (
      <div className="panel mx-auto w-full max-w-xl space-y-4 p-5">
        {done ? null : (
          <div className="text-center">
            <p className="label-mono text-gold">Expires in</p>
            <p
              className="mt-1 font-mono text-4xl text-gold tabular-nums"
              role="timer"
            >
              {remaining == null ? "0:00" : formatRemaining(remaining)}
            </p>
          </div>
        )}
        <p className="label-mono text-gold">Pay this address</p>
        <p className="break-all font-mono text-lg leading-snug text-ink">
          {quote.depositAddress}
        </p>
        <dl>
          {quote.amountIn ? (
            <Row
              label="Send"
              value={`${quote.amountInFormatted ?? formatToken(quote.amountIn, payToken?.decimals ?? 6)} ${payToken?.symbol ?? ""} on ${payToken?.blockchain ?? "this chain"}`}
              strong
            />
          ) : null}
          <Row label="Status" value={STATUSES[status] ?? status} />
        </dl>
        {quote.depositMemo ? (
          <p className="text-sm">
            Include memo <span className="font-mono">{quote.depositMemo}</span>
          </p>
        ) : null}
        {scan ? (
          <div className="flex flex-col items-center gap-2">
            <img
              src={scan.image}
              alt="Payment QR code"
              width={220}
              height={220}
              className="rounded-md"
            />
            <p className="text-sm text-ink-muted">{scan.wallets}</p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">
            {originAsset
              ? `Copy this address into your ${payToken?.blockchain ?? "NEAR"} wallet.`
              : "Copy this address into your wallet."}
          </p>
        )}
        <button
          type="button"
          className="btn-line text-sm"
          onClick={() => {
            void navigator.clipboard.writeText(quote.depositAddress ?? "");
            toast.success("Pay address copied.");
          }}
        >
          Copy pay address
        </button>
        <p className="text-xs text-ink-muted" aria-live="polite">
          {done
            ? "This quote is finished."
            : "Send that exact amount to the address above. This page watches until it settles."}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <div className="panel flex flex-wrap items-end justify-between gap-4 p-5">
        <div>
          <p className="label-mono">Amount due</p>
          <p className="mt-1 font-mono text-3xl">{money(atoms)}</p>
          <p className="mt-2 text-sm text-ink-muted">
            Paid to <span className="font-mono text-ink">{recipient}</span>
          </p>
        </div>
      </div>
      <Tabs
        label="How to pay"
        value={rail}
        onChange={setRail}
        options={[
          ["marks", "Pay with Marks"],
          ["intents", "Pay with Intents"],
        ]}
      />
      {rail === "marks" ? (
        <MarksPay
          amount={amount}
          merchant={recipient}
          paymentId={payment.id}
          markets={markets}
          shares={shares}
        />
      ) : busy === "Opening" ? (
        <Spinner />
      ) : (
        <form
          className="panel h-fit space-y-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void requestQuote(false);
          }}
        >
          {recipient.endsWith(".testnet") ? (
            <p className="text-sm text-gold" role="status">
              This link pays {recipient}. Pay with Intents works only when the
              merchant is a NEAR mainnet account. Your sign-in does not change
              who gets paid.
            </p>
          ) : account && network === "testnet" ? (
            <p className="text-sm text-gold" role="status">
              Pay with Intents works only on mainnet. Sign out, then sign in and
              choose mainnet.
            </p>
          ) : null}
          <ChainSelect
            id={tokenId}
            tokens={tokens}
            value={token?.assetId ?? ""}
            onChange={(next) => {
              setAssetId(next);
              setQuote(null);
              setExpiresAt(null);
              setScan(null);
              setStatus("");
              setError("");
            }}
          />
          <div>
            <label htmlFor={refundId} className="label-mono">
              Refund address on {token?.blockchain ?? "that chain"}
            </label>
            <p className="mt-1 text-xs text-ink-muted">
              Returned here if the payment does not complete.
            </p>
            <input
              id={refundId}
              className="field mt-1 font-mono"
              autoComplete="off"
              spellCheck={false}
              placeholder={refundHint(token?.blockchain)}
              value={refundTo}
              onChange={(event) => setRefundTo(event.target.value)}
            />
          </div>
          {error ? (
            <p className="text-sm text-gold" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn-gold" disabled={Boolean(busy)}>
              Pay with Intents
            </button>
            <button
              type="button"
              className="btn-line"
              disabled={Boolean(busy)}
              onClick={() => void requestQuote(true)}
            >
              {busy === "Quoting" ? "Quoting" : "Preview"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function refundHint(chain: string | undefined) {
  if (chain === "Solana") return "Your Solana address";
  if (chain === "NEAR") return "you.near";
  return "0x…";
}

function ChainSelect({
  id,
  tokens,
  value,
  onChange,
}: {
  id: string;
  tokens: OriginToken[];
  value: string;
  onChange: (assetId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = `${id}-list`;
  const current = tokens.find((item) => item.assetId === value) ?? tokens[0];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root}>
      <p id={`${id}-label`} className="label-mono">
        You pay with
      </p>
      <button
        id={id}
        type="button"
        className="field mt-1 flex items-center justify-between gap-3 text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => setOpen((next) => !next)}
      >
        <span id={`${id}-value`}>
          {current
            ? `${current.symbol} on ${current.blockchain}`
            : "Choose a chain"}
        </span>
        <IconChevronDown
          size={18}
          aria-hidden
          className={open ? "rotate-180" : undefined}
        />
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={`${id}-label`}
          className="mt-1 h-60 overflow-y-auto overscroll-contain rounded-lg border border-line bg-bg py-1"
        >
          {tokens.map((item) => {
            const selected = item.assetId === current?.assetId;
            return (
              <li key={item.assetId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`flex min-h-11 w-full items-center px-3 text-left text-sm ${
                    selected
                      ? "bg-bg-raised text-gold"
                      : "text-ink hover:bg-bg-raised"
                  }`}
                  onClick={() => {
                    onChange(item.assetId);
                    setOpen(false);
                  }}
                >
                  {item.symbol} on {item.blockchain}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function useRemaining(deadline: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  if (!deadline) return null;
  const end = Date.parse(deadline);
  if (Number.isNaN(end)) return null;
  return Math.max(0, end - now);
}

function formatRemaining(ms: number) {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
