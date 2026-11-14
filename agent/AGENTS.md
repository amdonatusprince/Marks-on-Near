# Marks — Agent Guide

This app is Marks: a perpetual futures, shares, loans and gifts desk on NEAR testnet, and its trading agent, in one Agent-Native app. The Marks pages live in `app/routes/` (home, markets, stocks, borrow, portfolio, send, faucet, gift claim) with components and libraries in `app/marks/`. The relayer, faucet, candles and quote routes are in `server/routes/api/`, and the price keeper is `server/plugins/marks-keeper.ts`. The agent panel (`AgentSidebar`) opens beside every Marks page, and each Marks tab registers itself as a browser session labelled "Marks desk".

## Marks actions

- `list-markets`, `get-market`, `get-account`, `list-shares`: chain reads through FastNEAR (`shared/marks.ts`). They read `VITE_CONTRACT_ID`, `VITE_TOKEN_ID` and `VITE_TESTNET_RPC`, the same variables as the pages. `get-account` includes gifts sent with their expiry (no claim secrets), the gift a position is held for, and each position's resting orders with their `orderId`. The contract has no per-trader order list, so `openOrders` scans `get_order` ids in batches of 10 and stops once the trader's open lots, or every lot on the book, are found.
- `plan-order`: the order ticket's own math. It imports `app/marks/lib/order-plan.ts` and `app/marks/lib/format.ts`, the modules the ticket uses, so the agent and the button agree to the atom.
- `day-trade`: research on any stock or token, then the Day Trader steps (Jake Schincariol, MIT). `step` is `scan`, `orb`, `news`, `entry`, `exit`, `timemachine`, `budget`, `risk`, `ticket`, `alerts`, `analyst` or `pelosi`. A name that is not on the Marks desk is still researched, and the result says so. Python tools live in `server/marks/day-trader/` and write under `agent/data/trader/`. Yahoo charts, never invented prices. A fill still goes through `trade-shares` or `plan-order` / `place-order` after an explicit yes, and only for a listed name. Alpaca is not used.
- Writes are typed server actions (`place-order`, `send-gift`, `claim-gift`, `refund-gift`, `trade-shares`, `borrow-usdc`, `pay-bill`, `create-payment-link`, `list-payment-links`, `get-payment-link`, `cancel-order`, `move-usdc`, `commit-margin`, `place-option`, `settle-option`) that call `runOnDesk` in `server/marks/desk-tab.ts`. It runs the client action of the same name (`app/marks/lib/desk-actions.ts`, registered from `desk-agent.tsx`) on the Marks tab the person used last. The generic browser-session tool is not used for writes because some model gateways strip its free-form `args` to `{}`. `claim-gift` opens a gift the way the link's Open button does. The secret stays in the URL hash. After a write lands, the open Marks page re-reads balances, positions, shares, loans and gifts. `create-payment-link` does not ask for a signature. It writes a `/checkout/<id>` link that pays the signed-in account. `pay-bill` with `paymentId` pays a testnet link and marks it paid. A mainnet link is paid by the person on the checkout page through NEAR Intents. The agent never sends that deposit.
- A client write shows the approval card with an **Open wallet** button, starts a job (`desk-jobs.ts`) and returns `{ jobId, status: "waiting" }` at once. `runOnDesk` prefixes the job id with the tab's session id so `check-desk-job` asks that same tab. `check-desk-job` waits up to 50 seconds per call and sets `dedupe: false`: the framework otherwise caches identical read-only calls and ends the turn after three repeats while the person is still signing.
- Every write uses the same function as the page button (`app/marks/lib/desk-writes.ts`, `create-gift.ts`, `place-order.ts`), so the pages and the agent cannot drift. `send-gift` keeps the claim secret in the browser and the returned link hash. The person's wallet signs. This app never holds keys.
- Pre-checks run on the server before a card appears, using the contract's own rules: `refund-gift` refuses an open gift before `expiry_ns` (30 days), `borrow-usdc` refuses a gifted position, an amount over `borrow_limit`, and raises a share lock to the minimum that keeps debt plus the 1% fee within 50% of the locked value, and `pay-bill` refuses a bill the balance and the chosen collateral cannot cover.

Run any of them from a shell with `pnpm action <name> --arg value`.

## Marks rules

- Page loaders read `SERVED_NETWORK` only. Page HTML and loader data are one shared CDN copy for every visitor, so nothing per-visitor goes into a loader. Chain routes export `headers = liveHeaders` to keep the cache at 5 seconds.
- Marks paths are listed in `MARKS_PATHS` in `app/marks/components/marks-shell.tsx`. A new public API route also needs an entry in `publicPaths` in `server/plugins/auth.ts`.
- A browser-only dependency loads with a dynamic `import()` inside the function that needs it, and a CommonJS dependency goes in `optimizeDeps.include` in `vite.config.ts`.

# Chat — Agent Guide

The template's chat lives at `/chat`; new chats start there. `/` is the Marks home and `/home` is the template's Get started page. Actions carry capabilities; screens exist only for durable workflows.

## Skills

Search with `rg --hidden --follow`; read the exact linked guide before deeper work. `.agents/skills/build-an-app/SKILL.md` — start here for vague requests to create a domain app. `.agents/skills/adding-a-feature/SKILL.md` — cross-area feature checklist. Data/integrations: `.agents/skills/actions/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/security/SKILL.md`, `.agents/skills/secrets/SKILL.md`, `.agents/skills/sharing/SKILL.md`. UI: `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`. Agent context/workflows: `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`, `.agents/skills/performance/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`. Framework: `.agents/skills/agent-native-docs/SKILL.md`, `.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`.

Use local docs only (no web research): `pnpm action docs-search --query "<topic>"`, `pnpm action docs-search --slug "<slug>"`, `pnpm action docs-search --list`, `pnpm action source-search --query "<pattern>"`, `pnpm action source-search --path <path>`, or `pnpm action source-search --list`. For external-agent integrations, read `pnpm action docs-search --slug "external-agents"`.

## Core rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Normal app data must flow through actions. Keep actions deterministic and focused; use agent chat/AgentSidebar for AI work and follow-ups in the same thread. Keep structured state in SQL and large files in configured storage; persist references only.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver. Never hardcode credentials, webhook URLs, or private/customer data.
- Never fabricate. Report failures and recover; verify writes by reading the row or screen. Navigation is in `<current-screen>`; use `view-screen` for fresh visible-record details.

For custom branding, keep `server/plugins/agent-native-email-branding.ts` aligned: `app.name` appears in transactional email and optional `app.logoUrl` must be an absolute HTTPS URL.

## Application state

- `navigation` describes the view and selected ids. Chat is `chat` at `/chat` and `/chat/<threadId>`; the Get started page is `home` at `/home`; `/` opens shared sign-in/signup.
- Use `navigate` when supported and `view-screen` for a fresh read of visible details; basic navigation is already in `<current-screen>`.

## Building a domain app

Choose the primary workflow and route before editing. Add a domain route under `app/routes/` and set `app.homePath` in `server/plugins/agent-native-email-branding.ts` with `defineAppConfig`. The default Get started page lives at `/home`, and Chat stays at `/chat`; edit `app/routes/home.tsx` when replacing that page with a domain-specific home. Add a static link in `app/components/layout/Sidebar.tsx` before `ChatThreadsSection`; `Header.tsx` uses `APP_TITLE` elsewhere. Shared sidebar and AgentInspector remain.

Use `adding-a-feature` for functional parity and `frontend-design` for a user-facing screen. Keep feature guidance here; do not rewrite `README.md` or `DESIGN.md`. After all edits, run one typecheck, one doctor check, and one browser smoke of the primary workflow, including overlap rejection, cancellation freeing the slot, and authenticated landing. Skip production build and extra test suites.

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.

- Guarded verification: run `pnpm agent-native:doctor`; fix findings before done.
