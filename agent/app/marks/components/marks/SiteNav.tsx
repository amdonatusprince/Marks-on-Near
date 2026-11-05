// From Moi (MIT): https://github.com/ramakrishnanhulk20/Moi. Links and account controls changed for Marks.
import Link from "@/marks/components/link";
import { useNear } from "@/marks/lib/near";
import { usePathname } from "@/marks/lib/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { AgentButton } from "@/marks/components/agent-button";
import { NearMark } from "@/marks/components/chain-icon";
import { HeaderAccount } from "@/marks/components/header-account";
import "./nav.css";

const LINKS = [
  { href: "/markets", label: "Perps" },
  { href: "/stocks", label: "Stocks" },
  { href: "/borrow", label: "Borrow" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/faucet", label: "Faucet" },
] as const;

/** The top bar. Links show after a wallet sign-in. Below 1024px they fold into the menu. */
export function SiteNav() {
  const pathname = usePathname();
  const { account } = useNear();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const sheetId = useId();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (sheet.current?.contains(target) || button.current?.contains(target))
        return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const active = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="site-nav" aria-label="Main">
      <Link
        className="site-brand site-brand-link"
        href="/"
        aria-label="Marks on NEAR, home"
      >
        <NearMark />
        <span className="site-wordmark">Marks</span>
      </Link>
      <div className="site-nav-right">
        {account ? (
          <div className="site-links">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                className="site-link"
                href={link.href}
                aria-current={active(link.href) ? "page" : undefined}
              >
                {link.label}
              </Link>
            ))}
          </div>
        ) : null}
        {account ? (
          <Link className="site-nav-cta" href="/send">
            Send a gift
          </Link>
        ) : null}
        {account ? <AgentButton /> : null}
        {account ? (
          <div className="site-account-bar">
            <HeaderAccount />
          </div>
        ) : (
          <HeaderAccount />
        )}
        {account ? (
          <button
            type="button"
            className="site-menu-button"
            ref={button}
            aria-expanded={open}
            aria-controls={sheetId}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((current) => !current)}
          >
            <MenuMark open={open} />
          </button>
        ) : null}
      </div>
      {account ? (
        <div className="site-sheet" id={sheetId} ref={sheet} hidden={!open}>
          {[...LINKS, { href: "/send", label: "Send a gift" }].map((link) => (
            <Link
              key={link.href}
              className="site-sheet-link"
              href={link.href}
              aria-current={active(link.href) ? "page" : undefined}
            >
              <span className="site-sheet-label">{link.label}</span>
            </Link>
          ))}
          <div className="site-sheet-account">
            <HeaderAccount compact={false} />
          </div>
        </div>
      ) : null}
    </nav>
  );
}

function MenuMark({ open }: { open: boolean }) {
  return (
    <svg
      className="site-menu-icon"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      {open ? (
        <path
          d="M5 5l10 10M15 5L5 15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      ) : (
        <path
          d="M3 5h14M3 10h14M3 15h14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      )}
    </svg>
  );
}
