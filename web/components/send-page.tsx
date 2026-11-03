"use client";

// Layout, copy rhythm and styles follow Moi's send page (MIT): https://github.com/ramakrishnanhulk20/Moi.
import { Certificate } from "@/components/marks/Certificate";
import { useNotify } from "@/components/toast";
import "@/components/marks/certificate.css";
import "@/components/marks/send.css";
import { RefreshPrice } from "@/components/stocks-desk";
import { figures, grouped, money } from "@/lib/format";
import { giftLink, newClaimKey, sealNote, MAX_NOTE_TEXT } from "@/lib/gift-key";
import { holdSecret, linksOf, pendingOf, saveLink, storageWorks } from "@/lib/gift-vault";
import { useNear } from "@/lib/near";
import { contractFor } from "@/lib/network";
import type { Market, Trader } from "@/lib/rpc";
import { useClock, useWallet } from "@/lib/use-v2";
import {
  UNIT,
  fee,
  isFresh,
  reason,
  shareSize,
  shareTicker,
  shortDate,
  units,
  valueOf,
  viewMarks,
  explorerTx,
  type Gift,
  type GiftAsset,
  type Share,
} from "@/lib/v2";
import { Fraunces } from "next/font/google";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState, type CSSProperties } from "react";

const displayItalic = Fraunces({
  subsets: ["latin"],
  style: ["italic"],
  axes: ["opsz", "SOFT", "WONK"],
  display: "swap",
});

type Kind = "shares" | "usdc" | "position";
type Choice = "5" | "10" | "25" | "100" | "other";
type Days = 7 | 30 | 90;
type Run =
  | { phase: "form" }
  | { phase: "sending"; step: string }
  | { phase: "done"; giftId: number; link: string; hash: string }
  | { phase: "error"; message: string };

const PRESETS: readonly Choice[] = ["5", "10", "25", "100"];
const LIFETIMES: readonly Days[] = [7, 30, 90];
const DRAWN = { "--hand": 1 } as CSSProperties;
const GIFT_GAS = "100000000000000";
const ZERO = BigInt(0);

type Held = { market: Market; trader: Trader };

export function SendPage({ shares, markets }: { shares: Share[]; markets: Market[] }) {
  const { account, network, openDialog, send } = useNear();
  const contract = contractFor(network);
  const { wallet, loading, refresh } = useWallet();
  const [kind, setKind] = useState<Kind>("shares");
  const [asset, setAsset] = useState(
    shares.find((share) => share.asset_id === "nvda")?.asset_id ?? shares[0]?.asset_id ?? "",
  );
  const [symbol, setSymbol] = useState("");
  const [choice, setChoice] = useState<Choice>("25");
  const [otherText, setOtherText] = useState("");
  const [note, setNote] = useState("");
  const [days, setDays] = useState<Days>(30);
  const [run, setRun] = useState<Run>({ phase: "form" });
  useNotify(run.phase === "error" ? run.message : "");
  const [positions, setPositions] = useState<Held[]>([]);
  const [listTick, setListTick] = useState(0);
  const noteId = useId();

  useEffect(() => {
    if (!account || kind !== "position") return;
    let cancelled = false;
    void Promise.all(
      markets.map((market) =>
        viewMarks<Trader>(network, "get_trader", { symbol: market.symbol, account_id: account })
          .then((trader) => ({ market, trader }))
          .catch(() => null),
      ),
    ).then((rows) => {
      if (cancelled) return;
      const open = rows.filter(
        (row): row is Held =>
          row !== null && row.trader.base_lots !== 0 && (row.trader.gift_id ?? null) === null,
      );
      setPositions(open);
      setSymbol((current) =>
        open.some((row) => row.market.symbol === current)
          ? current
          : (open[0]?.market.symbol ?? ""),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [account, network, markets, kind, listTick]);

  const share = shares.find((item) => item.asset_id === asset) ?? null;
  const position = positions.find((row) => row.market.symbol === symbol) ?? null;
  const amountText = (choice === "other" ? otherText : choice).replace(/[$,\s]/g, "");
  const amount = /^\d+(\.\d{0,2})?$/.test(amountText)
    ? BigInt(Math.round(Number(amountText) * 1e6))
    : ZERO;
  const price = share ? BigInt(share.price) : ZERO;
  const giftUnits = kind === "shares" && price > ZERO ? (amount * UNIT) / price : ZERO;
  const held = BigInt(wallet.holdings[asset] ?? "0");
  const buyFirst = kind === "shares" && held < giftUnits;
  const equity = position ? BigInt(position.trader.equity ?? "0") : ZERO;
  const giftValue =
    kind === "position" ? equity : kind === "shares" ? valueOf(giftUnits, price) : amount;
  const giftFee = fee(giftValue > ZERO ? giftValue : ZERO);
  const balance = BigInt(wallet.balance);
  const needs = (kind === "usdc" ? amount : buyFirst ? amount : ZERO) + giftFee;

  const preview = useMemo(() => {
    if (kind === "usdc") {
      return {
        figure: figures(amount),
        holding: "US DOLLARS ON NEAR",
        worth: "PAID IN mUSDC",
      };
    }
    if (kind === "position") {
      if (!position) return { figure: "0", holding: "CONTRACTS OF A PERP", worth: null };
      const lots = position.trader.base_lots;
      return {
        figure: grouped(Math.abs(lots)),
        holding: `${position.market.symbol} ${lots > 0 ? "LONG" : "SHORT"} CONTRACTS`,
        worth: `EQUITY ${money(equity)}`,
      };
    }
    return {
      figure: units(giftUnits, 4),
      holding: share
        ? `${share.asset_id === "xau" || share.asset_id === "oil" ? "UNITS" : "SHARES"} OF ${share.name.toUpperCase()}`
        : "SHARES",
      worth: `WORTH ${money(amount)}`,
    };
  }, [kind, amount, position, equity, giftUnits, share]);

  const hint = (() => {
    if (!account) return "Sign in first.";
    if (kind === "shares" && !share) return "Pick a share.";
    if (kind === "position" && !position) return "Open a perp position first, then send it here.";
    if (kind !== "position" && amount === ZERO) return "Choose an amount.";
    if (needs > balance)
      return `You need ${money(needs)} in your Marks balance. The faucet page tops it up.`;
    return null;
  })();
  const now = useClock();
  const stale = kind === "shares" && share !== null && now !== null && !isFresh(share, now);

  const start = async () => {
    if (!account || !contract || hint) return;
    if (!storageWorks()) {
      setRun({
        phase: "error",
        message:
          "This browser is not saving site data, so the gift link would be lost. Allow site data and try again.",
      });
      return;
    }
    try {
      const claim = newClaimKey(contract, account);
      holdSecret(contract, account, claim.claimKey, claim.secret);
      setRun({ phase: "sending", step: "Sealing your note" });
      const sealed = await sealNote(claim.secret, note);
      let giftAsset: GiftAsset;
      if (kind === "usdc") {
        giftAsset = { kind: "usdc", amount: amount.toString() };
      } else if (kind === "position") {
        giftAsset = { kind: "position", symbol };
      } else {
        let unitsToGive = giftUnits;
        if (buyFirst) {
          setRun({ phase: "sending", step: `Buying ${shareTicker(asset)}` });
          await send("buy_shares", { asset_id: asset, amount: amount.toString() });
          const after = await viewMarks<[string, string][]>(network, "get_holdings", {
            account_id: account,
          });
          const now = BigInt(Object.fromEntries(after)[asset] ?? "0");
          unitsToGive = now < giftUnits ? now : giftUnits;
        }
        giftAsset = { kind: "shares", asset_id: asset, units: unitsToGive.toString() };
      }
      setRun({ phase: "sending", step: "Locking the gift" });
      const hash = await send(
        "create_gift",
        {
          asset: giftAsset,
          claim_key: claim.claimKey,
          key_proof: claim.keyProof,
          expiry_days: days,
          note: sealed,
        },
        { gas: GIFT_GAS },
      );
      setRun({ phase: "sending", step: "Finding your gift" });
      let gift: Gift | undefined;
      for (let attempt = 0; attempt < 6 && !gift; attempt += 1) {
        const sent = await viewMarks<Gift[]>(network, "get_gifts_sent", { account_id: account });
        gift = sent.find((item) => item.claim_key === claim.claimKey);
        if (!gift) await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (!gift)
        throw new Error(
          "The gift was sent, but it is not listed yet. Reload this page in a minute.",
        );
      const link = giftLink(window.location.origin, gift.id, claim.secret);
      saveLink(contract, account, claim.claimKey, gift.id, link);
      setRun({ phase: "done", giftId: gift.id, link, hash });
      refresh();
      setListTick((value) => value + 1);
    } catch (caught) {
      setRun({ phase: "error", message: reason(caught) });
    }
  };

  const locked = run.phase === "sending" || run.phase === "done";

  return (
    <div
      className="send-page"
      data-run={run.phase === "form" || run.phase === "error" ? "form" : run.phase}
    >
      <div className="send-main mx-auto max-w-[1440px]">
        <header className="send-head">
          <p className="send-label">SEND A GIFT · 1 PERCENT FEE · NO GAS FOR THEM</p>
          <h1 className="send-title">
            Send someone
            <br />
            <span
              className="send-title-italic"
              style={{ fontFamily: displayItalic.style.fontFamily }}
            >
              a piece of the market.
            </span>
          </h1>
        </header>

        <div className="send-cols">
          <div className="send-form-col">
            <div className="send-form">
              <div className="send-connect">
                {account ? (
                  <p className="send-wallet">
                    <span>{account}</span>
                    <span className="send-wallet-dot">{" · "}</span>
                    <span>{loading ? "…" : `${money(wallet.balance)} in Marks`}</span>
                  </p>
                ) : (
                  <>
                    <button
                      type="button"
                      className="send-primary send-primary-tall"
                      onClick={openDialog}
                    >
                      Sign in to send
                    </button>
                    <p className="send-hint">
                      Google or any NEAR wallet. Your friend needs neither until they open it.
                    </p>
                  </>
                )}
              </div>

              <fieldset className="send-fields" disabled={locked}>
                <div className="send-block">
                  <p className="send-label send-label-small">WHAT TO SEND</p>
                  <div className="send-chips" role="group" aria-label="What to send">
                    {(
                      [
                        ["shares", "A share"],
                        ["usdc", "USDC"],
                        ["position", "A perp position"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        type="button"
                        className="send-chip"
                        key={value}
                        aria-pressed={kind === value}
                        onClick={() => setKind(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {kind === "shares" ? (
                  <div className="send-grid" role="group" aria-label="Share">
                    {shares.map((item) => (
                      <button
                        type="button"
                        key={item.asset_id}
                        className="send-tile"
                        data-selected={item.asset_id === asset ? "true" : undefined}
                        aria-pressed={item.asset_id === asset}
                        onClick={() => setAsset(item.asset_id)}
                      >
                        <span className="send-logo send-logo-blank" aria-hidden="true">
                          {item.name.slice(0, 1)}
                        </span>
                        <span className="send-tile-text">
                          <span className="send-tile-name">{item.name}</span>
                          <span className="send-tile-symbol">{shareTicker(item.asset_id)}</span>
                        </span>
                        <span className="send-tile-price">{money(item.price)}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {kind === "position" ? (
                  account && positions.length === 0 ? (
                    <p className="send-note-text">
                      You have no open position to send. Open one on the{" "}
                      <Link className="send-link send-link-small" href="/markets">
                        perps desk
                      </Link>
                      .
                    </p>
                  ) : (
                    <div className="send-grid" role="group" aria-label="Position">
                      {positions.map(({ market, trader }) => (
                        <button
                          type="button"
                          key={market.symbol}
                          className="send-tile"
                          data-selected={market.symbol === symbol ? "true" : undefined}
                          aria-pressed={market.symbol === symbol}
                          onClick={() => setSymbol(market.symbol)}
                        >
                          <span className="send-tile-text">
                            <span className="send-tile-name">{market.symbol}</span>
                            <span className="send-tile-symbol">
                              {trader.base_lots > 0 ? "LONG" : "SHORT"}{" "}
                              {grouped(Math.abs(trader.base_lots))}
                            </span>
                          </span>
                          <span className="send-tile-price">{money(trader.equity ?? "0")}</span>
                        </button>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="send-block">
                    <div className="send-chips" role="group" aria-label="Amount in US dollars">
                      {PRESETS.map((preset) => (
                        <button
                          type="button"
                          className="send-chip"
                          key={preset}
                          aria-pressed={choice === preset}
                          onClick={() => setChoice(preset)}
                        >
                          ${preset}
                        </button>
                      ))}
                      {choice === "other" ? (
                        <label className="send-chip send-chip-input" data-selected="true">
                          <span aria-hidden="true">$</span>
                          <input
                            className="send-chip-field"
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            aria-label="Amount in US dollars"
                            placeholder="0.00"
                            autoFocus
                            value={otherText}
                            onChange={(event) => {
                              if (/^\d{0,6}(\.\d{0,2})?$/.test(event.target.value))
                                setOtherText(event.target.value);
                            }}
                          />
                        </label>
                      ) : (
                        <button
                          type="button"
                          className="send-chip"
                          aria-pressed={false}
                          onClick={() => setChoice("other")}
                        >
                          Other
                        </button>
                      )}
                    </div>
                    {kind === "shares" && share && amount > ZERO ? (
                      <p className="send-hint">
                        About {units(giftUnits)} {shareTicker(share.asset_id)}, at{" "}
                        {money(share.price)} for {shareSize(share.asset_id)}
                        {buyFirst
                          ? `. You hold ${units(held)}, so Marks buys the rest first.`
                          : ", from what you hold."}
                      </p>
                    ) : null}
                  </div>
                )}

                <div className="send-block">
                  <textarea
                    className="send-textarea"
                    rows={3}
                    value={note}
                    placeholder="Write them a note. Only the link can read it."
                    aria-label="A note for the person you are gifting"
                    aria-describedby={noteId}
                    onChange={(event) => setNote(event.target.value.slice(0, MAX_NOTE_TEXT))}
                  />
                  <p className="send-counter" id={noteId}>
                    {MAX_NOTE_TEXT - new TextEncoder().encode(note).length} left
                  </p>
                </div>

                <div className="send-block">
                  <div className="send-chips" role="group" aria-label="How long the gift lasts">
                    {LIFETIMES.map((option) => (
                      <button
                        type="button"
                        className="send-chip"
                        key={option}
                        aria-pressed={days === option}
                        onClick={() => setDays(option)}
                      >
                        {option} days
                      </button>
                    ))}
                  </div>
                  <p className="send-hint">
                    If they don&apos;t open it in time, you can take it back.
                  </p>
                </div>

                <dl className="send-summary">
                  <div className="send-summary-row">
                    <dt>THE GIFT</dt>
                    <dd>{kind === "position" ? `${money(equity)} of equity` : money(amount)}</dd>
                  </div>
                  <div className="send-summary-row">
                    <dt>GIFT WRAP, 1 PERCENT</dt>
                    <dd>{money(giftFee)}</dd>
                  </div>
                  <div className="send-summary-row">
                    <dt>FROM YOUR MARKS BALANCE</dt>
                    <dd>{money(needs)}</dd>
                  </div>
                  <div className="send-summary-row">
                    <dt>NETWORK FEES</dt>
                    <dd>under 0.01 NEAR</dd>
                  </div>
                </dl>

                {stale && share ? (
                  <RefreshPrice share={share} onDone={() => window.location.reload()} />
                ) : (
                  <button
                    type="button"
                    className="send-primary send-primary-tall"
                    disabled={hint !== null || locked}
                    onClick={() => void start()}
                  >
                    {run.phase === "sending" ? run.step : "Send the gift"}
                  </button>
                )}
                {hint && run.phase === "form" ? (
                  <p className="send-hint" role="status">
                    {hint}
                  </p>
                ) : null}
                {kind === "position" ? (
                  <p className="send-hint">
                    The position is frozen while the gift is open: no orders, no borrowing. If it is
                    liquidated first, the gift is void and the fee is spent.
                  </p>
                ) : null}
              </fieldset>
            </div>
            {account && contract ? (
              <MyGifts
                contract={contract}
                account={account}
                tick={listTick}
                onChange={() => setListTick((value) => value + 1)}
              />
            ) : null}
          </div>

          <aside className="send-side" data-mode={run.phase === "done" ? "done" : "form"}>
            {run.phase === "done" ? (
              <LinkCard
                link={run.link}
                giftId={run.giftId}
                hash={run.hash}
                onSendAnother={() => {
                  setNote("");
                  setRun({ phase: "form" });
                }}
              />
            ) : (
              <div className="send-preview">
                <p className="send-label send-label-small">WHAT THEY&apos;LL SEE</p>
                <div className="send-cert" style={DRAWN}>
                  <Certificate
                    figure={preview.figure}
                    holding={preview.holding}
                    worth={preview.worth}
                  />
                </div>
                {note.trim() === "" ? null : (
                  <p
                    className="send-preview-note"
                    style={{ fontFamily: displayItalic.style.fontFamily }}
                  >
                    {note}
                  </p>
                )}
                {run.phase === "error" ? (
                  <button
                    type="button"
                    className="send-secondary send-secondary-inline mt-8"
                    onClick={() => setRun({ phase: "form" })}
                  >
                    Try again
                  </button>
                ) : null}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

const BULLETS = "•".repeat(8);

function LinkCard({
  link,
  giftId,
  hash,
  onSendAnother,
}: {
  link: string;
  giftId: number;
  hash: string;
  onSendAnother: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const masked = `${new URL(link).origin}/g/${giftId}#${BULLETS}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setShown(true);
    }
  };
  const mail = `mailto:?subject=${encodeURIComponent("A gift for you on Marks")}&body=${encodeURIComponent(
    `I sent you a gift on Marks. Open it with Google, no wallet needed:\n\n${link}`,
  )}`;
  return (
    <section className="send-card send-rise" aria-label="Your gift">
      <h2 className="send-card-title">Your gift is ready.</h2>
      <div className="send-field">
        <code className="send-field-text" data-shown={shown ? "true" : undefined}>
          {shown ? link : masked}
        </code>
        <button
          type="button"
          className="send-link send-link-small"
          onClick={() => setShown((value) => !value)}
          aria-pressed={shown}
        >
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      <div className="send-card-actions">
        <button type="button" className="send-primary" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy link"}
        </button>
        <a className="send-secondary" href={mail}>
          Email it
        </a>
      </div>
      <p className="send-warning">Anyone with this link can open the gift. Send it only to them.</p>
      {hash ? (
        <p className="send-warning">
          <a
            className="send-link send-link-small"
            href={explorerTx(hash)}
            target="_blank"
            rel="noreferrer"
          >
            See the transaction
          </a>
        </p>
      ) : null}
      <button type="button" className="send-link" onClick={onSendAnother}>
        Send another gift
      </button>
    </section>
  );
}

function describe(asset: GiftAsset) {
  if (asset.kind === "usdc") return money(asset.amount);
  if (asset.kind === "shares") return `${units(asset.units)} ${shareTicker(asset.asset_id)}`;
  return asset.symbol;
}

const CHIPS: Record<Gift["status"], { text: string; tone: string } | null> = {
  open: null,
  claimed: { text: "OPENED", tone: "opened" },
  refunded: { text: "TAKEN BACK", tone: "taken-back" },
  voided: { text: "VOID", tone: "taken-back" },
};

/** Gifts this account sent and received, read from the contract, with the sender's saved links. */
function MyGifts({
  contract,
  account,
  tick,
  onChange,
}: {
  contract: string;
  account: string;
  tick: number;
  onChange: () => void;
}) {
  const { network, send } = useNear();
  const [sent, setSent] = useState<Gift[] | null>(null);
  const [received, setReceived] = useState<Gift[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [problem, setProblem] = useState("");

  const load = useCallback(async () => {
    const [out, into] = await Promise.all([
      viewMarks<Gift[]>(network, "get_gifts_sent", { account_id: account }).catch(
        () => [] as Gift[],
      ),
      viewMarks<Gift[]>(network, "get_gifts_received", { account_id: account }).catch(
        () => [] as Gift[],
      ),
    ]);
    const pending = pendingOf(contract, account);
    for (const gift of out) {
      const secret = pending[gift.claim_key];
      if (secret)
        saveLink(
          contract,
          account,
          gift.claim_key,
          gift.id,
          giftLink(window.location.origin, gift.id, secret),
        );
    }
    setLinks(linksOf(contract, account));
    setSent([...out].sort((a, b) => b.id - a.id));
    setReceived([...into].sort((a, b) => b.id - a.id));
  }, [account, contract, network]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  if (!sent || (sent.length === 0 && received.length === 0)) return null;
  const now = Date.now() * 1e6;

  return (
    <section className="send-gifts send-rise" aria-label="Your gifts">
      {sent.length > 0 ? (
        <>
          <p className="send-label">GIFTS YOU SENT</p>
          <ul className="send-gift-list">
            {sent.map((gift) => {
              const chip = CHIPS[gift.status];
              const link = links[String(gift.id)];
              const expired = gift.status === "open" && gift.expiry_ns <= now;
              return (
                <li className="send-gift" key={gift.id}>
                  <span className="send-gift-id">#{gift.id}</span>
                  <span className="send-gift-symbol">{describe(gift.asset)}</span>
                  <span className="send-gift-state">
                    {chip ? (
                      <span className={`send-gift-chip send-gift-chip-${chip.tone}`}>
                        {chip.text}
                      </span>
                    ) : expired ? (
                      "Expired"
                    ) : (
                      `Waiting to be opened, until ${shortDate(gift.expiry_ns)}`
                    )}
                  </span>
                  <span className="send-gift-actions">
                    {gift.status === "open" && link ? (
                      <button
                        type="button"
                        className="send-link send-link-small"
                        onClick={() =>
                          void navigator.clipboard.writeText(link).then(() => {
                            setCopied(gift.id);
                            window.setTimeout(() => setCopied(null), 2000);
                          })
                        }
                      >
                        {copied === gift.id ? "Copied" : "Copy link"}
                      </button>
                    ) : null}
                    {expired ? (
                      <button
                        type="button"
                        className="send-link send-link-small"
                        disabled={busy === gift.id}
                        onClick={() => {
                          setBusy(gift.id);
                          setProblem("");
                          void send("refund_gift", { gift_id: gift.id }, { gas: GIFT_GAS })
                            .then(() => {
                              onChange();
                              return load();
                            })
                            .catch((caught) => setProblem(reason(caught)))
                            .finally(() => setBusy(null));
                        }}
                      >
                        {busy === gift.id ? "Taking it back" : "Take it back"}
                      </button>
                    ) : null}
                  </span>
                  {gift.recipient ? (
                    <p className="send-gift-note">Opened by {gift.recipient}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {problem ? <p className="send-warning">{problem}</p> : null}
        </>
      ) : null}
      {received.length > 0 ? (
        <>
          <p className="send-label mt-10">GIFTS YOU OPENED</p>
          <ul className="send-gift-list">
            {received.map((gift) => (
              <li className="send-gift" key={gift.id}>
                <span className="send-gift-id">#{gift.id}</span>
                <span className="send-gift-symbol">{describe(gift.asset)}</span>
                <span className="send-gift-state">from {gift.sender}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
