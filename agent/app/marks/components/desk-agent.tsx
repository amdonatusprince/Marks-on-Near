import { useAgentNativeEmbeddedBrowserSession } from "@agent-native/core/client/AgentNativeEmbedded";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useRevalidator } from "react-router";

import { TAB_ID } from "@/lib/tab-id";
import { useToast } from "@/marks/components/toast";
import {
  deskActions,
  type AskCard,
  type DeskLive,
} from "@/marks/lib/desk-actions";
import { useNear } from "@/marks/lib/near";
import { contractFor } from "@/marks/lib/network";

type Approval = AskCard & { resolve: (approved: boolean) => void };

/** Registers this tab's desk with the agent: the client actions it can run and what the page shows. */
export function DeskAgent() {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const { pathname } = useLocation();
  const toast = useToast();
  const near = useNear();
  const [approval, setApproval] = useState<Approval | null>(null);
  const live = useRef({ near, pathname });
  live.current = { near, pathname };
  const lastActiveAt = useRef(Date.now());

  useEffect(() => {
    const mark = () => {
      if (document.visibilityState === "visible")
        lastActiveAt.current = Date.now();
    };
    window.addEventListener("focus", mark);
    window.addEventListener("pointerdown", mark);
    window.addEventListener("keydown", mark);
    document.addEventListener("visibilitychange", mark);
    return () => {
      window.removeEventListener("focus", mark);
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("keydown", mark);
      document.removeEventListener("visibilitychange", mark);
    };
  }, []);

  const goToMarket = useCallback(
    (symbol: string) => {
      const path = `/markets/${symbol}`;
      if (live.current.pathname !== path) navigate(path);
    },
    [navigate],
  );

  const ask = useCallback((card: AskCard) => {
    let mine: Approval["resolve"] | null = null;
    return new Promise<boolean>((resolve) => {
      mine = resolve;
      setApproval((previous) => {
        previous?.resolve(false);
        return { ...card, resolve };
      });
    }).finally(() =>
      setApproval((current) => (current?.resolve === mine ? null : current)),
    );
  }, []);

  const actions = useMemo(
    () =>
      deskActions(
        (): DeskLive => {
          const { near: wallet, pathname: path } = live.current;
          const account =
            wallet.account ||
            document.documentElement.dataset.marksAccount ||
            sessionStorage.getItem("marks-near-account");
          return {
            account,
            ready: wallet.ready,
            network: wallet.network,
            send: wallet.send,
            sendMany: wallet.sendMany,
            openDialog: wallet.openDialog,
            pathname: path,
          };
        },
        ask,
        goToMarket,
        toast,
      ),
    [ask, goToMarket, toast],
  );

  const getContext = useCallback(() => {
    const { near: wallet, pathname: path } = live.current;
    const symbol = /^\/markets\/([^/]+)/.exec(path)?.[1];
    const accountId =
      wallet.account ||
      document.documentElement.dataset.marksAccount ||
      sessionStorage.getItem("marks-near-account");
    return {
      url: window.location.href,
      title: accountId ? `Marks · ${accountId}` : document.title,
      route: {
        pathname: path,
        name: symbol ? "market" : path,
        params: symbol ? { symbol } : {},
      },
      ...(accountId ? { user: { id: accountId, name: accountId } } : {}),
      ...(accountId
        ? {
            resource: {
              type: "near-account",
              id: accountId,
              name: accountId,
            },
          }
        : {}),
      data: {
        app: "Marks",
        network: wallet.network,
        contract: contractFor(wallet.network),
        nearAccountId: accountId,
        accountId,
        walletConnected: Boolean(accountId),
        walletReady: wallet.ready,
        doNotAskToSignIn: Boolean(accountId),
        symbol: symbol ?? null,
        lastActiveAt: lastActiveAt.current,
        clientActions: [
          "open-market",
          "fill-ticket",
          "place-order",
          "send-gift",
          "check-desk-job",
          "refund-gift",
          "trade-shares",
          "refresh-price",
          "borrow-usdc",
          "cancel-order",
          "commit-margin",
          "move-usdc",
          "place-option",
          "settle-option",
        ],
      },
    };
  }, []);

  const onNavigate = useCallback(
    (payload: unknown) => {
      const target =
        typeof payload === "string"
          ? payload
          : ((payload as { path?: string; to?: string; url?: string } | null)
              ?.path ??
            (payload as { to?: string } | null)?.to ??
            (payload as { url?: string } | null)?.url);
      if (target?.startsWith("/")) navigate(target);
    },
    [navigate],
  );

  const onRefresh = useCallback(() => {
    window.dispatchEvent(new Event("marks-traded"));
    void revalidator.revalidate();
  }, [revalidator]);

  const onRequestApproval = useCallback(() => true, []);

  const hostSession = useMemo(
    () => ({
      id: TAB_ID,
      label: near.account ? `Marks desk (${near.account})` : "Marks desk",
      ...(near.account
        ? { user: { id: near.account, name: near.account } }
        : {}),
    }),
    [near.account],
  );

  useAgentNativeEmbeddedBrowserSession({
    enabled: near.ready && Boolean(near.account),
    actions,
    getContext,
    session: hostSession,
    browserSession: {
      label: hostSession.label,
      sessionId: TAB_ID,
      ttlMs: 180_000,
    },
    onNavigate,
    onRefresh,
    onRequestApproval,
  });

  return approval ? <ApprovalCard approval={approval} /> : null;
}

function ApprovalCard({ approval }: { approval: Approval }) {
  const approve = useRef<HTMLButtonElement>(null);
  useEffect(() => approve.current?.focus(), []);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 sm:items-center"
      role="presentation"
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="agent-approval-title"
        aria-describedby="agent-approval-body"
        className="w-full max-w-md rounded-lg border border-line bg-bg-raised p-5 text-ink"
        onKeyDown={(event) => {
          if (event.key === "Escape") approval.resolve(false);
        }}
      >
        <p className="text-xs uppercase tracking-[0.18em] text-ink-muted">
          Your agent asks
        </p>
        <h2 id="agent-approval-title" className="mt-2 font-display text-2xl">
          {approval.title}
        </h2>
        <dl
          id="agent-approval-body"
          className="mt-4 grid grid-cols-2 gap-y-2 text-sm"
        >
          {approval.rows.map((row) => (
            <span key={row.label} className="contents">
              <dt className="text-ink-muted">{row.label}</dt>
              <dd className="text-right font-mono">{row.value}</dd>
            </span>
          ))}
        </dl>
        <p className="mt-4 text-sm text-ink-muted">
          {approval.hint ?? "Your wallet asks you to sign next."}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn-line min-h-11 px-4 py-2"
            onClick={() => approval.resolve(false)}
          >
            Decline
          </button>
          <button
            ref={approve}
            type="button"
            className="btn-gold min-h-11 px-4 py-2"
            onClick={() => approval.resolve(true)}
          >
            Open wallet
          </button>
        </div>
      </section>
    </div>
  );
}
