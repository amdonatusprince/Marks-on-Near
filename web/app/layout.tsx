import type { Metadata } from "next";
import { Fraunces, JetBrains_Mono, Manrope } from "next/font/google";
import { Grain } from "@/components/marks/Grain";
import { SiteNav } from "@/components/marks/SiteNav";
import { SignInDialog } from "@/components/sign-in-dialog";
import { ToastProvider } from "@/components/toast";
import { NearProvider } from "@/lib/near";
import { selectedNetwork } from "@/lib/network-server";
import Link from "next/link";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
  variable: "--font-display",
  display: "swap",
});

const body = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Marks: trade, borrow and gift on NEAR", template: "%s · Marks" },
  description:
    "Perpetuals, tokenized shares and capped calls on NEAR. Borrow against a position, and send a share or a position to a friend as a link.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const network = await selectedNetwork();
  return (
    <html
      lang="en"
      className={`h-full ${display.variable} ${body.variable} ${mono.variable}`}
      style={{ backgroundColor: "#0e0809" }}
    >
      <body
        className="flex min-h-dvh flex-col bg-bg font-body text-ink antialiased"
        style={{ backgroundColor: "#0e0809", color: "#f6efe6" }}
      >
        <NearProvider initialNetwork={network}>
          <ToastProvider>
            <div className="ambient" aria-hidden="true">
              <span className="ambient-orb ambient-orb-a" />
              <span className="ambient-orb ambient-orb-b" />
              <span className="ambient-orb ambient-orb-c" />
            </div>
            <SiteNav />
            <main className="relative z-[1] flex w-full flex-1 flex-col">{children}</main>
            <footer className="relative z-[1] shrink-0 border-t border-line">
              <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-4 py-6 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between md:px-6">
                <p>Marks runs on NEAR testnet with mock USDC from the faucet.</p>
                <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-1">
                  {[
                    ["/markets", "Perps"],
                    ["/stocks", "Stocks"],
                    ["/borrow", "Borrow"],
                    ["/send", "Send a gift"],
                    ["/faucet", "Faucet"],
                  ].map(([href, label]) => (
                    <Link
                      key={href}
                      href={href}
                      className="inline-flex min-h-10 items-center hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {label}
                    </Link>
                  ))}
                </nav>
              </div>
            </footer>
            <Grain fixed />
            <SignInDialog />
          </ToastProvider>
        </NearProvider>
      </body>
    </html>
  );
}
