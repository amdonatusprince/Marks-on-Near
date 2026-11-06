"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./toast.css";

type Tone = "ok" | "error" | "info";

type Item = {
  id: number;
  tone: Tone;
  title: string;
  href?: string;
  label?: string;
  leaving: boolean;
};

type Link = { href: string; label: string };

type Api = {
  success: (title: string, link?: Link) => void;
  error: (title: string) => void;
  info: (title: string) => void;
};

const ToastContext = createContext<Api | null>(null);

const HOLD: Record<Tone, number> = { ok: 5200, error: 8000, info: 6400 };

const flashed = new Set<string>();

/** Collapses the extra effect run from React strict mode without swallowing a later action. */
export function notifyOnce(key: string) {
  if (flashed.has(key)) return false;
  flashed.add(key);
  window.setTimeout(() => flashed.delete(key), 50);
  return true;
}

const KICKER: Record<Tone, string> = {
  ok: "Done",
  error: "Didn't go through",
  info: "Note",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const timers = useRef(new Map<number, number>());
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setItems((list) => list.filter((item) => item.id !== id));
      return;
    }
    setItems((list) => list.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
    window.setTimeout(() => {
      setItems((list) => list.filter((item) => item.id !== id));
    }, 150);
  }, []);

  const pause = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (!timer) return;
    window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const resume = useCallback(
    (id: number, ms: number) => {
      if (timers.current.has(id)) return;
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), ms),
      );
    },
    [dismiss],
  );

  const push = useCallback(
    (tone: Tone, title: string, link?: Link) => {
      const id = ++seq.current;
      setItems((list) =>
        [...list, { id, tone, title, href: link?.href, label: link?.label, leaving: false }].slice(
          -4,
        ),
      );
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), HOLD[tone]),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
    };
  }, []);

  const api = useMemo<Api>(
    () => ({
      success: (title, link) => push("ok", title, link),
      error: (title) => push("error", title),
      info: (title) => push("info", title),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-relevant="additions">
        {items.map((item) => (
          <article
            key={item.id}
            className="toast"
            data-tone={item.tone}
            data-leaving={item.leaving ? "true" : "false"}
            role={item.tone === "error" ? "alert" : "status"}
            onMouseEnter={() => pause(item.id)}
            onMouseLeave={() => {
              if (!item.leaving) resume(item.id, HOLD[item.tone]);
            }}
            onFocus={() => pause(item.id)}
            onBlur={(event) => {
              if (event.currentTarget.contains(event.relatedTarget)) return;
              if (!item.leaving) resume(item.id, HOLD[item.tone]);
            }}
          >
            <span className="toast-rail" aria-hidden="true" />
            <div className="toast-copy">
              <p className="toast-kicker label-mono">{KICKER[item.tone]}</p>
              <p className="toast-title">{item.title}</p>
              {item.href ? (
                <a className="toast-link" href={item.href} target="_blank" rel="noreferrer">
                  {item.label ?? "View the transaction"}
                </a>
              ) : null}
            </div>
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss"
              onClick={() => dismiss(item.id)}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
          </article>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const api = useContext(ToastContext);
  if (!api) throw new Error("ToastProvider is missing");
  return api;
}

/** Shows a toast when `message` becomes non-empty, including after it is cleared and set again. */
export function useNotify(message: string, tone: Tone = "error") {
  const toast = useToast();
  const last = useRef("");
  useEffect(() => {
    if (!message) {
      last.current = "";
      return;
    }
    if (last.current === message) return;
    last.current = message;
    if (!notifyOnce(`${tone}|${message}`)) return;
    if (tone === "ok") toast.success(message);
    else if (tone === "info") toast.info(message);
    else toast.error(message);
  }, [message, tone, toast]);
}
