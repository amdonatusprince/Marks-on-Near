import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { runOnDesk } from "../server/marks/desk-tab";

export default defineAction({
  description:
    "Refresh an oracle price. kind share uses an asset id such as xau. kind market uses a symbol such as BNB-PERP. Costs 0.02 NEAR. Returns jobId; poll check-desk-job.",
  schema: z.object({
    kind: z.enum(["share", "market"]),
    id: z
      .string()
      .describe("Share id such as xau, or a market symbol such as BNB-PERP."),
  }),
  run: (args) => runOnDesk("refresh-price", args),
});
