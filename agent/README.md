# Marks agent

The Marks desk and its trading agent in one [Agent-Native](https://www.agent-native.com/docs/) app. Pages, relayer, faucet, price keeper, wallets and Agent chat all run from this folder.

The product README is at [`../README.md`](../README.md). The agent section there is the source of truth for what chat can read and write.

```sh
pnpm install
pnpm dev          # http://localhost:3000, press Agent
pnpm typecheck
pnpm action list-markets
pnpm action list-shares --assetId nvda
pnpm action plan-order --accountId you.testnet --symbol SOL-PERP --side long --amount 300
```

Server actions live in `actions/` (`list-markets`, `get-market`, `get-account`, `list-shares`, `plan-order`). Client actions on the Marks tab live in `app/marks/lib/desk-actions.ts` and cover the same writes as the pages: perps, shares, loans, gifts, faucet and options. `send-gift` uses `app/marks/lib/create-gift.ts`, the same path as `/send`. The person's wallet signs. This app never holds keys.
