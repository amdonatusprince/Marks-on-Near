import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { runOnDesk } from "../server/marks/desk-tab";

export default defineAction({
  description:
    "Buy or sell Marks shares at the oracle price, same as /stocks. A stale price adds a refresh signature first. Returns jobId; poll check-desk-job.",
  schema: z.object({
    side: z.enum(["buy", "sell"]),
    assetId: z.string().describe("Share id from list-shares, such as nvda."),
    amount: z
      .string()
      .describe(
        "Dollars to spend when buying; share units when selling, such as 0.12.",
      ),
  }),
  run: (args) => runOnDesk("trade-shares", args),
});
