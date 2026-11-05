// Screens, copy rhythm and styles follow Moi's claim page (MIT): https://github.com/ramakrishnanhulk20/Moi.
import { useNotify } from "@/marks/components/toast";
import "@/marks/components/marks/certificate.css";
import "@/marks/components/marks/claim.css";
import "@/marks/components/marks/hero.css";
import {
  ClaimStage,
  type SceneState,
} from "@/marks/components/marks/ClaimStage";
import type { CertificateProps } from "@/marks/components/marks/Certificate";
import { figures, money } from "@/marks/lib/format";
import { claimSignature, openNote, publicKeyOf } from "@/marks/lib/gift-key";
import { useNear } from "@/marks/lib/near";
import { contractFor } from "@/marks/lib/network";
import {
  explorerTx,
  reason,
  shareTicker,
  units,
  valueOf,
  viewMarks,
  type Gift,
  type Share,
} from "@/marks/lib/v2";
import { displayItalic } from "@/marks/lib/fonts";
import Link from "@/marks/components/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

type View =
  | { screen: "loading" }
  | { screen: "invalid" }
  | { screen: "claimed" | "refunded" | "voided" | "expired"; gift: Gift }
  | { screen: "ready"; gift: Gift }
  | { screen: "opening"; gift: Gift }
  | {
      screen: "opened";
      gift: Gift;
      note: string;
      hash: string;
      recipient: string;
    }
  | { screen: "error"; gift: Gift | null; message: string; started: boolean };

function sceneOf(view: View): SceneState | null {
  switch (view.screen) {
    case "invalid":
      return null;
    case "loading":
    case "ready":
      return "closed";
    case "refunded":
    case "voided":
    case "expired":
      return "dimmed";
    case "claimed":
      return "claimed";
    case "opening":
      return "opening";
    case "opened":
      return "opened";
    case "error":
      return view.started ? "half-open" : "closed";
  }
}

function expiryText(ns: number) {
  const date = new Date(ns / 1e6);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function nameOf(gift: Gift, shares: Share[]) {
  const { asset } = gift;
  if (asset.kind === "usdc") return "US dollars";
  if (asset.kind === "position") return asset.symbol;
  return (
    shares.find((share) => share.asset_id === asset.asset_id)?.name ??
    shareTicker(asset.asset_id)
  );
}

function countOf(gift: Gift) {
  const { asset } = gift;
  if (asset.kind === "usdc") return `${money(asset.amount)} IN mUSDC`;
  if (asset.kind === "position") return `AN OPEN ${asset.symbol} POSITION`;
  return `${units(asset.units)} ${shareTicker(asset.asset_id)}`;
}

export function ClaimFlow({ giftId }: { giftId: number | null }) {
  const { account, network, ready, openDialog, signOut, send } = useNear();
  const contract = contractFor(network);
  const [view, setView] = useState<View>({ screen: "loading" });
  const [secret, setSecret] = useState("");
  useNotify(view.screen === "error" ? view.message : "");
  const [shares, setShares] = useState<Share[]>([]);

  useEffect(() => {
    const fragment = window.location.hash.slice(1).toLowerCase();
    if (giftId === null || !/^[0-9a-f]{64}$/.test(fragment) || !contract) {
      setView({ screen: "invalid" });
      return;
    }
    setSecret(fragment);
    let cancelled = false;
    void Promise.all([
      viewMarks<Gift | null>(network, "get_gift", { gift_id: giftId }),
      viewMarks<Share[]>(network, "get_shares").catch(() => [] as Share[]),
    ])
      .then(([gift, list]) => {
        if (cancelled) return;
        setShares(list);
        if (!gift || publicKeyOf(fragment) !== gift.claim_key)
          return setView({ screen: "invalid" });
        if (gift.status === "claimed")
          return setView({ screen: "claimed", gift });
        if (gift.status === "refunded")
          return setView({ screen: "refunded", gift });
        if (gift.status === "voided")
          return setView({ screen: "voided", gift });
        if (gift.expiry_ns <= Date.now() * 1e6)
          return setView({ screen: "expired", gift });
        setView({ screen: "ready", gift });
      })
      .catch(
        (caught) =>
          !cancelled &&
          setView({
            screen: "error",
            gift: null,
            message: reason(caught),
            started: false,
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [giftId, network, contract]);

  const gift = "gift" in view ? view.gift : null;
  const certificate = useMemo<CertificateProps | undefined>(() => {
    if (!gift) return undefined;
    const { asset } = gift;
    if (asset.kind === "usdc") {
      return {
        figure: figures(asset.amount),
        holding: "US DOLLARS ON NEAR",
        worth: "PAID IN mUSDC",
      };
    }
    if (asset.kind === "position") {
      return {
        figure: "1",
        holding: `OPEN ${asset.symbol} POSITION`,
        worth: null,
      };
    }
    const share = shares.find((item) => item.asset_id === asset.asset_id);
    return {
      figure: units(asset.units, 4),
      holding: `SHARES OF ${(share?.name ?? shareTicker(asset.asset_id)).toUpperCase()}`,
      worth: share
        ? `WORTH ${money(valueOf(BigInt(asset.units), BigInt(share.price)))} TODAY`
        : null,
    };
  }, [gift, shares]);

  const open = useCallback(async () => {
    if (!gift || !account || !contract) return;
    setView({ screen: "opening", gift });
    const signature = claimSignature(contract, secret, gift.id, account);
    try {
      let hash = "";
      const response = await fetch("/api/gift/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gift_id: gift.id,
          recipient: account,
          signature,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        hash?: string;
        error?: string;
      };
      if (response.ok && body.hash) {
        hash = body.hash;
      } else {
        // With the relayer down, the recipient's own account submits the same signed claim.
        hash = await send(
          "claim_gift",
          { gift_id: gift.id, recipient: account, signature },
          { gas: "100000000000000" },
        );
      }
      const note = await openNote(secret, gift.note).catch(() => "");
      setView({ screen: "opened", gift, note, hash, recipient: account });
    } catch (caught) {
      setView({
        screen: "error",
        gift,
        message: reason(caught),
        started: true,
      });
    }
  }, [gift, account, contract, secret, send]);

  const scene = sceneOf(view);
  return (
    <div className="claim-page" data-scene={scene === null ? "none" : "shown"}>
      {scene === null ? null : (
        <ClaimStage state={scene} certificate={certificate} />
      )}
      <section
        className="claim-panel"
        key={view.screen}
        data-screen={view.screen}
        aria-live="polite"
      >
        <Panel
          view={view}
          shares={shares}
          account={account}
          ready={ready}
          onSignIn={openDialog}
          onSignOut={() => void signOut()}
          onOpen={() => void open()}
          onRetry={() => gift && setView({ screen: "ready", gift })}
        />
      </section>
    </div>
  );
}

function Panel({
  view,
  shares,
  account,
  ready,
  onSignIn,
  onSignOut,
  onOpen,
  onRetry,
}: {
  view: View;
  shares: Share[];
  account: string | null;
  ready: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpen: () => void;
  onRetry: () => void;
}) {
  switch (view.screen) {
    case "loading":
      return (
        <>
          <p className="claim-meta">OPENING THE LINK</p>
          <span className="claim-skel" />
          <span className="claim-skel claim-skel-short" />
        </>
      );
    case "invalid":
      return (
        <>
          <h1 className="claim-h">{"This link doesn't open a gift."}</h1>
          <p className="claim-body">
            It may have been cut short or changed. Ask the sender to send it
            again, whole.
          </p>
          <p className="claim-links">
            <Link className="claim-link" href="/">
              What is Marks?
            </Link>
          </p>
        </>
      );
    case "claimed":
      return (
        <>
          <h1 className="claim-h">This gift has been opened.</h1>
          <p className="claim-body">
            It belongs to {view.gift.recipient ?? "whoever opened it"}. If that
            was you, it is already in your Marks account.
          </p>
          <p className="claim-links">
            <Link className="claim-link" href="/portfolio">
              See your portfolio
            </Link>
          </p>
        </>
      );
    case "refunded":
      return (
        <>
          <h1 className="claim-h">This gift went back to the sender.</h1>
          <p className="claim-body">
            Gifts that are not opened before they expire return to whoever sent
            them.
          </p>
        </>
      );
    case "voided":
      return (
        <>
          <h1 className="claim-h">This gift can no longer be opened.</h1>
          <p className="claim-body">
            The position inside it was liquidated before anyone opened it.
          </p>
        </>
      );
    case "expired":
      return (
        <>
          <h1 className="claim-h">This gift has expired.</h1>
          <p className="claim-body">
            The sender can now take it back. Ask them to send you a new one.
          </p>
        </>
      );
    case "ready": {
      const name = nameOf(view.gift, shares);
      return (
        <>
          <p className="claim-meta">{`A GIFT FOR YOU · FROM ${view.gift.sender.toUpperCase()} · OPEN BY ${expiryText(view.gift.expiry_ns)}`}</p>
          <h1 className="claim-h claim-h-big">
            Someone sent you
            <br />
            <em
              className="claim-italic"
              style={{ fontFamily: displayItalic.style.fontFamily }}
            >
              {view.gift.asset.kind === "position"
                ? `their ${name} trade.`
                : `a piece of ${name}.`}
            </em>
          </h1>
          <p className="claim-count">{countOf(view.gift)}</p>
          {!ready ? (
            <button type="button" className="claim-primary" disabled>
              Getting ready
            </button>
          ) : !account ? (
            <>
              <button
                type="button"
                className="claim-primary"
                onClick={onSignIn}
              >
                Sign in to open it
              </button>
              <p className="claim-fine">
                Use Google. Marks makes a NEAR account for you: no seed phrase,
                no fees.
              </p>
            </>
          ) : (
            <>
              <p className="claim-who">
                <span>
                  Signed in as <span className="claim-nowrap">{account}</span>
                </span>
                <button
                  type="button"
                  className="claim-link claim-link-small"
                  onClick={onSignOut}
                >
                  Not you? Sign out
                </button>
              </p>
              {view.gift.asset.kind === "position" ? (
                <p className="claim-fine">
                  The position moves into your account on{" "}
                  {view.gift.asset.symbol}. Your account needs no open position
                  there.
                </p>
              ) : null}
              <button
                type="button"
                className="claim-primary claim-open"
                onClick={onOpen}
              >
                Open your gift
              </button>
            </>
          )}
        </>
      );
    }
    case "opening":
      return <Opening />;
    case "opened":
      return (
        <>
          <h1 className="claim-h claim-h-big">{"It's yours."}</h1>
          <p className="claim-body claim-body-ink">
            {`${countOf(view.gift).toLowerCase()} ${view.gift.asset.kind === "position" ? "is" : "are"} in ${view.recipient} on Marks.`}
          </p>
          {view.note ? (
            <blockquote className="claim-note">
              <p
                className="claim-note-text"
                style={{ fontFamily: displayItalic.style.fontFamily }}
              >
                {view.note}
              </p>
              <p className="claim-note-from">A NOTE FROM THE SENDER</p>
            </blockquote>
          ) : null}
          <p className="claim-links">
            {view.hash ? (
              <a
                className="claim-link"
                href={explorerTx(view.hash)}
                target="_blank"
                rel="noopener noreferrer"
              >
                See it on NearBlocks
              </a>
            ) : null}
            <Link className="claim-link" href="/portfolio">
              Open your portfolio
            </Link>
          </p>
          <Link className="claim-secondary" href="/send">
            Send someone a gift
          </Link>
        </>
      );
    case "error":
      return (
        <div className="claim-error">
          <h1 className="claim-error-h">{"That didn't work"}</h1>
          <button
            type="button"
            className="claim-link claim-retry"
            onClick={view.gift ? onRetry : () => window.location.reload()}
          >
            Try again
          </button>
        </div>
      );
  }
}

function Opening() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  return (
    <>
      <h1 className="claim-h claim-h-opening">Opening your gift</h1>
      <p className="claim-body">
        Marks is moving it into your account and paying the network fee. NEAR
        usually confirms in two seconds.
      </p>
      <p className="claim-timer">{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</p>
    </>
  );
}
