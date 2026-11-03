"use client";

import { useNear } from "@/lib/near";
import type { Network } from "@/lib/network";
import { useState, type KeyboardEvent } from "react";

const options = ["testnet", "mainnet"] as const;

export function NetworkSwitch() {
  const { network, setNetwork } = useNear();
  const [pending, setPending] = useState(false);

  async function choose(next: Network) {
    if (next === network || pending) return;
    setPending(true);
    try {
      await setNetwork(next);
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = options.indexOf(network);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = options[(index + step + options.length) % options.length];
    void choose(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Network"
      className="flex h-10 items-center rounded-md border border-border bg-background p-0.5"
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const selected = network === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={pending}
            className={`h-9 rounded px-3 text-xs font-medium capitalize focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60 ${
              selected
                ? option === "mainnet"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
                : "text-muted-foreground"
            }`}
            onClick={() => void choose(option)}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
