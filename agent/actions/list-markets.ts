import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { marketSummary, markets } from "../shared/marks";

export default defineAction({
  description:
    "List every Marks perpetual market on NEAR testnet with its mark price, index price, open interest, volume and margin rates. Reads the chain directly.",
  schema: z.object({
    category: z
      .string()
      .optional()
      .describe(
        "Only markets in this category, such as crypto, stocks or commodities.",
      ),
  }),
  readOnly: true,
  mcpTool: true,
  run: async ({ category }) => {
    const all = await markets();
    const wanted = category?.toLowerCase();
    return {
      markets: all
        .filter((item) => !wanted || item.category.toLowerCase() === wanted)
        .map(marketSummary),
    };
  },
});
