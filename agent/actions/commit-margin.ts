import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { runOnDesk } from "../server/marks/desk-tab";

export default defineAction({
  description:
    "Move Marks balance into one market's margin, same as Commit on the market page. Returns jobId; poll check-desk-job.",
  schema: z.object({
    symbol: z.string().describe("Market symbol, such as SOL-PERP."),
    amount: z.string().describe("Dollars, such as 100."),
  }),
  run: (args) => runOnDesk("commit-margin", args),
});
