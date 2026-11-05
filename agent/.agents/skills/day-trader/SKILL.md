---
name: day-trader
description: >-
  Day-trading skills on the Marks desk: scan setups, news, time the
  entry and exit, replay odds, size and risk-check, then a Marks ticket.
  Use when they say scan, setups, opening range, breakout, time the
  entry, stop and target, odds, size this trade, risk check, or day trade.
scope: agent
---

# Day trader on Marks

The Python tools are Jake Schincariol's Day Trader skill
(https://github.com/Jakeschincariol/day-trader-skill, MIT). Marks runs
them with `day-trade`. They read free Yahoo charts. They never invent a
price. A hit is a chart that matched a rule, not a buy. Most people who
day trade lose money.

Scan the Marks names (Apple, Amazon, Microsoft, Nvidia, Tesla, gold, oil,
BTC, ETH, BNB, SOL, NEAR), not 5,900 US stocks, unless they ask for a
wider list.

```
scan -> news -> entry -> exit -> timemachine -> budget -> risk -> ticket
```

Then, and only then, a Marks write:

- A share (`tsla`, `aapl`, `xau`, …): `trade-shares`
- A perp (`TSLA-PERP`, `GOLD-PERP`, …): `plan-order`, then `place-order`

They type yes for that exact ticket. They press Open wallet on the Marks
tab. Never Alpaca. Never place on a BLOCK from `risk`.

| they say | call |
| --- | --- |
| scan, setups, breakouts, flags | `day-trade { step: "scan" }` or `{ step: "orb", at: "10:15" }` |
| news on Tesla | `day-trade { step: "news", symbol: "TSLA" }` |
| is it time | `day-trade { step: "entry", symbol: "TSLA" }` |
| stop and target | `day-trade { step: "exit" }` |
| what are the odds | `day-trade { step: "timemachine" }` |
| size it | `day-trade { step: "budget", accountId }` |
| check risk | `day-trade { step: "risk", accountId }` |
| show the ticket / yes | `day-trade { step: "ticket" }` then `{ step: "ticket", reply: "yes" }` |
| earnings | `day-trade { step: "analyst", symbol: "AAPL" }` |
| Pelosi filings | `day-trade { step: "pelosi" }` |

Gold is `xau` / `GC=F` / `GOLD-PERP`. Oil is `oil` / `CL=F` / `OIL-PERP`.

Say what was scanned and when. Say "matched a rule", never "a winner".
The Time Machine is a replay of recent bars, not a prediction. A stop is
a plan, not a fill. Not financial advice.
