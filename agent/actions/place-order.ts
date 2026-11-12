import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { runOnDesk } from "../server/marks/desk-tab";

export default defineAction({
  description:
    "Place a perp order through the same path as the Place order button. Pass the ticket from plan-order. Returns jobId; poll check-desk-job.",
  schema: z.object({
    symbol: z.string().describe("Market symbol, such as SOL-PERP."),
    side: z.enum(["bid", "ask"]).describe("bid is long, ask is short."),
    kind: z
      .enum(["limit", "post_only", "immediate_or_cancel"])
      .optional()
      .describe("Default limit."),
    price: z
      .string()
      .describe("Limit price in dollars, from plan-order's ticket."),
    amount: z.string().describe("Order size in dollars of notional."),
  }),
  run: (args) => runOnDesk("place-order", args),
});
