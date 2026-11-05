import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { fundingWords } from "../app/marks/lib/format";
import {
  levels,
  market,
  marketSummary,
  viewChain,
  type Level,
} from "../shared/marks";

export default defineAction({
  description:
    "Read one Marks market: mark and index price, funding, margin rates and the order book (best bids and asks). Use the symbol, such as SOL-PERP.",
  schema: z.object({
    symbol: z
      .string()
      .describe("Market symbol, such as SOL-PERP or NVDA-PERP."),
    depth: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(8)
      .describe("Book levels per side."),
  }),
  readOnly: true,
  mcpTool: true,
  run: async ({ symbol, depth }) => {
    const item = await market(symbol);
    const [book, funding] = await Promise.all([
      viewChain<{ bids: Level[]; asks: Level[] }>("get_l2", {
        symbol: item.symbol,
        depth,
      }),
      viewChain<number>("get_funding_rate_bps", { symbol: item.symbol }).catch(
        () => 0,
      ),
    ]);
    return {
      ...marketSummary(item),
      funding: fundingWords(funding),
      bids: levels(book.bids, item.tick_size),
      asks: levels(book.asks, item.tick_size),
    };
  },
});
