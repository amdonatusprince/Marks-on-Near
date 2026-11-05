import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { runOnDesk } from "../server/marks/desk-tab";

export default defineAction({
  description:
    "Buy or write a capped call, same as /stocks. seriesId from list-shares. Returns jobId; poll check-desk-job.",
  schema: z.object({
    seriesId: z.string(),
    side: z.enum(["bid", "ask"]).describe("bid buys the call, ask writes it."),
    premium: z.string().describe("Premium in dollars per contract."),
    lots: z.number().int().positive().describe("Contract count."),
  }),
  run: (args) => runOnDesk("place-option", args),
});
