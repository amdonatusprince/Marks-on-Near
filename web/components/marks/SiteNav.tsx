"use client";

// From Moi (MIT): https://github.com/ramakrishnanhulk20/Moi. Links and account controls changed for Marks.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { NearMark } from "@/components/chain-icon";
import { HeaderAccount } from "@/components/header-account";
import { NetworkSwitch } from "@/components/network-switch";
import "./nav.css";

const LINKS = [
  { href: "/markets", label: "Perps" },
  { href: "/stocks", label: "Stocks" },
  { href: "/borrow", label: "Borrow" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/faucet", label: "Faucet" },
] as const;

/** The top bar. From 1024px the links sit inline; below that they fold into a MENU sheet. */
export function SiteNav() {
  const pathname = usePathname();
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
      if (sheet.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="site-nav" aria-label="Main">
      <Link className="site-brand site-brand-link" href="/" aria-label="Marks on NEAR, home">
        <NearMark />
        <span className="site-wordmark">Marks</span>
      </Link>
      <div className="site-nav-right">
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
        <div className="site-tools">
          <NetworkSwitch />
        </div>
        <Link className="site-nav-cta" href="/send">
          Send a gift
        </Link>
        <HeaderAccount />
        <button
          type="button"
          className="site-menu-button"
          ref={button}
          aria-expanded={open}
          aria-controls={sheetId}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="site-menu-label">{open ? "CLOSE" : "MENU"}</span>
        </button>
      </div>
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
        <div className="site-sheet-tools">
          <NetworkSwitch />
        </div>
      </div>
    </nav>
  );
}
