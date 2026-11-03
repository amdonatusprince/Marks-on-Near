import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { HeaderAccount } from "@/components/header-account";
import { NetworkSwitch } from "@/components/network-switch";
import { NearProvider } from "@/lib/near";
import { selectedNetwork } from "@/lib/network-server";
import { SignInDialog } from "@/components/sign-in-dialog";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Marks",
  description: "Perpetual markets on NEAR. A listing cannot be switched off.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const network = await selectedNetwork();
  return (
    <html lang="en" style={{ backgroundColor: "#0e1014" }}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        style={{ backgroundColor: "#0e1014", color: "#f4f4f5" }}
      >
        <NearProvider initialNetwork={network}>
          <header className="border-b border-border bg-card">
            <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-3 py-3 md:px-4">
              <Link
                href="/"
                className="text-lg font-semibold tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                Marks
              </Link>
              <div className="flex items-center gap-3">
                <NetworkSwitch />
                <HeaderAccount />
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-[1440px] px-3 py-3 md:px-4">{children}</main>
          <SignInDialog />
        </NearProvider>
      </body>
    </html>
  );
}
