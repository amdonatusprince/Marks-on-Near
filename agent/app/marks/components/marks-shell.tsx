import { useSession } from "@agent-native/core/client/hooks";
import { AgentSidebar } from "@agent-native/toolkit/app/chat";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";

import { DeskAgent } from "@/marks/components/desk-agent";
import Link from "@/marks/components/link";
import { Grain } from "@/marks/components/marks/Grain";
import { SiteNav } from "@/marks/components/marks/SiteNav";
import { SignInDialog } from "@/marks/components/sign-in-dialog";
import { ToastProvider } from "@/marks/components/toast";
import { NearProvider, useNear } from "@/marks/lib/near";
import { SERVED_NETWORK } from "@/marks/lib/network";
import { TAB_ID } from "@/lib/tab-id";

export const MARKS_PATHS = [
  "/",
  "/markets",
  "/stocks",
  "/borrow",
  "/pay",
  "/checkout",
  "/portfolio",
  "/send",
  "/faucet",
  "/g",
];

export function isMarksPath(pathname: string) {
  return MARKS_PATHS.some((path) =>
    path === "/"
      ? pathname === "/"
      : pathname === path || pathname.startsWith(`${path}/`),
  );
}

const FOOTER_LINKS = [
  ["/markets", "Perps"],
  ["/stocks", "Stocks"],
  ["/borrow", "Borrow"],
  ["/pay", "Pay"],
  ["/send", "Send a gift"],
  ["/faucet", "Faucet"],
] as const;

export function MarksShell({ children }: { children: ReactNode }) {
  return (
    <NearProvider initialNetwork={SERVED_NETWORK}>
      <ToastProvider>
        <MarksAgent>
          <div className="marks-app flex min-h-dvh flex-col bg-bg font-body text-ink antialiased">
            <div className="ambient" aria-hidden="true">
              <span className="ambient-orb ambient-orb-a" />
              <span className="ambient-orb ambient-orb-b" />
              <span className="ambient-orb ambient-orb-c" />
            </div>
            <SiteNav />
            <main className="relative z-[1] flex w-full flex-1 flex-col">
              {children}
            </main>
            <MarksFooter />
            <Grain fixed />
            <SignInDialog />
          </div>
        </MarksAgent>
      </ToastProvider>
    </NearProvider>
  );
}

function MarksFooter() {
  const { account, network } = useNear();
  return (
    <footer className="relative z-[1] shrink-0 border-t border-line">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-4 py-6 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between md:px-6">
        <p>
          {network === "mainnet"
            ? "Signed in on NEAR mainnet. Marks trades stay on testnet."
            : "Marks runs on NEAR testnet with mock USDC from the faucet."}
        </p>
        {account ? (
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-1">
            {FOOTER_LINKS.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="inline-flex min-h-10 items-center hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
              >
                {label}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
    </footer>
  );
}

function MarksAgent({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const navigate = useNavigate();
  const signedIn = status === "authenticated";
  return (
    <AgentSidebar
      position="right"
      enabled={signedIn}
      storageKey="marks"
      browserTabId={TAB_ID}
      agentPageHref="/settings/agent"
      onFullscreenRequest={(threadId) =>
        navigate(threadId ? `/chat/${encodeURIComponent(threadId)}` : "/chat")
      }
      emptyStateText="Your personal finance and on-chain analyst. Start a new chat."
      suggestions={[
        "How is my Marks account looking?",
        "Gift a friend $25 of NVDA",
        "Buy 0.01 BTC-PERP at market",
      ]}
    >
      {signedIn ? <DeskAgent /> : null}
      {children}
    </AgentSidebar>
  );
}
