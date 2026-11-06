import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  deskFacts,
  marksSymbols,
  marksTicket,
  resolveDesk,
  runTool,
  writeMarksPortfolio,
} from "../server/marks/day-trader/run";

function noted<T extends { next?: string; ok?: boolean }>(
  result: T,
  asked?: string,
): T & {
  desk?: ReturnType<typeof deskFacts> | ReturnType<typeof deskFacts>[];
  offDesk?: string[];
} {
  const names = (asked || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!names.length) return result;
  const rows = names.map((name) => deskFacts(name));
  const off = rows.filter((row) => !row.listed);
  const aside = off.length
    ? ` ${off.map((row) => `${row.name} (${row.yahoo})`).join(", ")} is not on the Marks desk. Say that in one line, then give the research. Do not call trade-shares or place-order for it.${result.ok === false ? " If this is a token, retry with the Yahoo pair, such as PEPE-USD." : ""}`
    : "";
  const desk = rows.length === 1 ? rows[0] : rows;
  if (!desk) return result;
  return {
    ...result,
    desk,
    offDesk: off.map((row) => row.yahoo),
    next: `${result.next || ""}${aside}`.trim(),
  };
}

const Step = z.enum([
  "scan",
  "orb",
  "news",
  "entry",
  "exit",
  "timemachine",
  "budget",
  "risk",
  "ticket",
  "alerts",
  "analyst",
  "pelosi",
]);

export default defineAction({
  description:
    "Research any stock or token, then a Marks ticket only if that name is listed. Use this for analyze, research, a market read, what to buy, news, earnings, a setup, entry, exit, odds, size, or risk. An unlisted name is still researched: say it is not on the desk, and do not place an order for it. Yahoo charts, never invents a price. A fill still needs place-order or trade-shares and the person's wallet. step scan|orb|news|entry|exit|timemachine|budget|risk|ticket|alerts|analyst|pelosi.",
  schema: z.object({
    step: Step.describe(
      "scan daily setups, orb opening-range breakouts, news headlines, entry bar check, exit stop/target, timemachine odds, budget size, risk check, ticket show/approve, alerts, analyst earnings, pelosi filings.",
    ),
    symbol: z
      .string()
      .optional()
      .describe(
        "Any stock or token. A Marks name such as TSLA or xau is listed. META or PEPE-USD is researched and reported as not listed. A token uses its Yahoo pair.",
      ),
    symbols: z
      .string()
      .optional()
      .describe(
        "Comma-separated names to scan. Defaults to the Marks desk list.",
      ),
    accountId: z
      .string()
      .optional()
      .describe(
        "NEAR account from the Marks tab, used to size against the Marks balance.",
      ),
    at: z
      .string()
      .optional()
      .describe("Cut an orb scan at this New York time, such as 10:15."),
    hours: z
      .number()
      .optional()
      .describe("News lookback in hours. Default 12."),
    reply: z
      .string()
      .optional()
      .describe(
        'For ticket: "yes" records approval of order 1. The wallet still has to sign on Marks.',
      ),
    alert: z
      .enum(["clock", "quote", "check", "add", "list"])
      .optional()
      .describe("alerts subcommand. Default check."),
  }),
  readOnly: true,
  mcpTool: true,
  run: async ({
    step,
    symbol,
    symbols,
    accountId,
    at,
    hours,
    reply,
    alert,
  }) => {
    if (accountId?.trim() && (step === "budget" || step === "risk")) {
      await writeMarksPortfolio(accountId.trim());
    }
    const desk = symbol ? resolveDesk(symbol) : null;
    const yahoo = desk?.yahoo;
    const list = marksSymbols(
      symbols || (yahoo && step !== "entry" ? yahoo : undefined),
    );
    const asked = [symbol, symbols].filter((item) => item?.trim()).join(",");

    if (step === "scan" || step === "orb") {
      const mode = step === "orb" ? "orb" : "daily";
      const args = [mode, "--symbols", list, "--json", "--min-price", "0"];
      if (mode === "orb" && at) args.push("--at", at);
      const result = await runTool("trader-scanner/scan.py", args, 90_000);
      return noted(
        {
          ...result,
          next: "Write which names matched a rule, with the price and date from this result. A hit is not a buy. Then day-trade news and analyst on the name they care about. Continue to entry only if they asked to trade a listed name.",
        },
        asked,
      );
    }

    if (step === "news") {
      const tickers = (yahoo ? [yahoo] : list.split(",")).filter(Boolean);
      const result = await runTool(
        "trader-news/news.py",
        [
          "--tickers",
          ...tickers,
          "--hours",
          String(hours ?? 12),
          "--no-sec",
          "--json",
        ],
        60_000,
      );
      return noted(
        {
          ...result,
          next: "Fold these headlines into the research note. Continue to analyst if you have not. Continue to entry only if they asked to trade a listed name.",
        },
        asked,
      );
    }

    if (step === "entry") {
      if (!yahoo) {
        return {
          ok: false,
          reason: "entry needs symbol, such as TSLA or xau.",
        };
      }
      const result = await runTool(
        "trader-entry/entry.py",
        ["check", yahoo, "--json", "--write"],
        45_000,
      );
      return noted(
        {
          ...result,
          next: result.ok
            ? "Triggered. Call day-trade step exit to set the stop and target."
            : "Not triggered yet. Say the status plainly. Do not place an order.",
        },
        asked,
      );
    }

    if (step === "exit") {
      const args = [
        "plan",
        "--stop",
        "or-mid",
        "--target",
        "1R",
        "--write",
        "--json",
      ];
      if (yahoo) args.push("--symbol", yahoo);
      const result = await runTool("trader-exit/exit.py", args, 45_000);
      return noted(
        {
          ...result,
          next: "Call day-trade step timemachine before sizing. A stop is a plan, not a fill.",
        },
        asked,
      );
    }

    if (step === "timemachine") {
      const result = await runTool(
        "trader-timemachine/timemachine.py",
        ["run", "--write", "--json"],
        120_000,
      );
      return {
        ...result,
        next: "These are odds from recent bars, not a promise. If they still want the trade, day-trade step budget.",
      };
    }

    if (step === "budget") {
      const result = await runTool(
        "trader-budget/size.py",
        ["--write", "--json"],
        20_000,
      );
      return {
        ...result,
        next: "Call day-trade step risk on that exact order.",
      };
    }

    if (step === "risk") {
      const result = await runTool("trader-risk/check.py", ["--json"], 20_000);
      return {
        ...result,
        next: result.ok
          ? "PASS is a rules check, not a recommendation. Call day-trade step ticket, then wait for an explicit yes."
          : "BLOCK. Say the reason. Do not place the order.",
      };
    }

    if (step === "ticket") {
      if (reply?.trim()) {
        const approved = await runTool(
          "trader-broker/ticket.py",
          ["approve", "--index", "1", "--reply", reply.trim(), "--json"],
          15_000,
        );
        const shown = await runTool(
          "trader-broker/ticket.py",
          ["show", "--index", "1", "--json"],
          15_000,
        );
        const order =
          shown.data &&
          typeof shown.data === "object" &&
          "orders" in shown.data &&
          Array.isArray((shown.data as { orders?: unknown[] }).orders)
            ? ((
                shown.data as {
                  orders: {
                    symbol?: string;
                    side?: string;
                    qty?: string;
                    plan?: { entry?: number };
                  }[];
                }
              ).orders[0] ?? null)
            : null;
        const marks = order ? marksTicket(order) : null;
        const tradable = Boolean(marks?.share || marks?.market);
        return noted(
          {
            ...approved,
            marks,
            next: approved.ok
              ? tradable
                ? "Recorded their yes. Show the Marks ticket. For shares call trade-shares. For a perp call plan-order then place-order. They press Open wallet on the Marks tab. Never send this to Alpaca."
                : "Recorded their yes. This name is not on the Marks desk, so there is nothing to sign. Give the research and stop."
              : "That reply is not a yes for this exact order.",
          },
          order?.symbol || asked,
        );
      }
      const result = await runTool(
        "trader-broker/ticket.py",
        ["show", "--json"],
        15_000,
      );
      return {
        ...result,
        next: "Show the ticket in plain words. Ask them to type yes for that exact order. Do not call place-order until they do.",
      };
    }

    if (step === "alerts") {
      const sub = alert || "check";
      const args =
        sub === "add"
          ? ["add", "--from-plan", "--json"]
          : sub === "quote" && yahoo
            ? ["quote", yahoo, "--write", "--json"]
            : [sub, "--json"];
      const result = await runTool("trader-alerts/alerts.py", args, 30_000);
      return noted(
        {
          ...result,
          next: "Alerts watch the Yahoo print. The Marks mark still needs refresh-price if it is stale.",
        },
        asked,
      );
    }

    if (step === "analyst") {
      if (!yahoo) {
        return {
          ok: false,
          reason: "analyst needs a stock symbol such as TSLA.",
        };
      }
      const result = await runTool(
        "trader-analyst/facts.py",
        [yahoo, "--json", "--no-filings"],
        60_000,
      );
      return noted(
        {
          ...result,
          next: "Write the research note from these figures: what changed, the level, and what would break the idea. A note is not an order.",
        },
        asked,
      );
    }

    if (step === "pelosi") {
      const result = await runTool(
        "trader-pelosi/ptr.py",
        ["index", "--member", "pelosi", "--json"],
        60_000,
      );
      return {
        ...result,
        next: "These are public STOCK Act filings, not inside information.",
      };
    }

    return { ok: false, reason: `Unknown step ${step}` };
  },
});
