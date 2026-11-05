import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { runOnDesk } from "../server/marks/desk-tab";

export default defineAction({
  description:
    "Cancel a resting perp order. Take orderId from get-account positions[].openOrders. Returns jobId; poll check-desk-job.",
  schema: z.object({
    symbol: z.string().describe("Market symbol, such as SOL-PERP."),
    orderId: z.number().describe("orderId from get-account openOrders."),
  }),
  run: (args) => runOnDesk("cancel-order", args),
});
