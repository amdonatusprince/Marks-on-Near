"use client";

import { useNear } from "@/lib/near";
import type { Network } from "@/lib/network";
import type { Trader } from "@/lib/rpc";
import { reason, viewMarks, viewToken, type ShareLoan } from "@/lib/v2";
import { useCallback, useEffect, useState } from "react";

let firstSymbol: Promise<string> | null = null;

/** The Marks balance is shared by every market, so any listed symbol reads it. */
async function anySymbol(network: Network) {
  firstSymbol ??= viewMarks<{ symbol: string }[]>(network, "get_markets").then(
    (markets) => markets[0]?.symbol ?? "",
  );
  return firstSymbol;
}

export async function marksBalance(network: Network, account: string) {
  const symbol = await anySymbol(network);
  if (!symbol) return "0";
  const trader = await viewMarks<Trader>(network, "get_trader", { symbol, account_id: account });
  return trader.unallocated;
}

export type Wallet = {
  /** mUSDC in the NEAR wallet, outside Marks. */
  usdc: string;
  /** mUSDC inside Marks, ready to trade, buy, gift or repay. */
  balance: string;
  holdings: Record<string, string>;
  loans: Record<string, ShareLoan>;
};

const EMPTY: Wallet = { usdc: "0", balance: "0", holdings: {}, loans: {} };

/** Balances for the signed-in account. `refresh` reads them again after a transaction. */
export function useWallet() {
  const { account, network } = useNear();
  const [wallet, setWallet] = useState<Wallet>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    if (!account) {
      setWallet(EMPTY);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      viewToken<string>(network, "ft_balance_of", { account_id: account }).catch(() => "0"),
      marksBalance(network, account).catch(() => "0"),
      viewMarks<[string, string][]>(network, "get_holdings", { account_id: account }).catch(
        () => [] as [string, string][],
      ),
      viewMarks<[string, ShareLoan][]>(network, "get_share_loans", { account_id: account }).catch(
        () => [] as [string, ShareLoan][],
      ),
    ])
      .then(([usdc, balance, holdings, loans]) => {
        if (cancelled) return;
        setWallet({
          usdc,
          balance,
          holdings: Object.fromEntries(holdings),
          loans: Object.fromEntries(loans),
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [account, network, tick]);

  return { wallet, loading, refresh };
}

/** The time after the first client render, and null before it, so server and client markup match. */
export function useClock() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** A send wrapper that tracks busy state, the last hash and the contract's reason on failure. */
export function useAction() {
  const [busy, setBusy] = useState("");
  const [hash, setHash] = useState("");
  const [error, setErrorState] = useState("");
  const [pulse, setPulse] = useState(0);
  const setError = useCallback((text: string) => {
    setErrorState(text);
    setPulse((n) => n + 1);
  }, []);
  const run = useCallback(
    async (label: string, action: () => Promise<string>) => {
      setBusy(label);
      setErrorState("");
      setHash("");
      try {
        const next = await action();
        setHash(next);
        return next;
      } catch (caught) {
        setError(reason(caught));
        return null;
      } finally {
        setBusy("");
      }
    },
    [setError],
  );
  return { busy, hash, error, pulse, run, setError };
}
