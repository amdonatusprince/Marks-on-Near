import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { runOnDesk } from "../server/marks/desk-tab";

export default defineAction({
  description:
    "Same as /faucet. claim mints 1,000 mUSDC once a day (no signature when the relayer is up). deposit moves wallet mUSDC into the Marks balance; withdraw sends it back. Returns jobId; poll check-desk-job.",
  schema: z.object({
    action: z.enum(["claim", "deposit", "withdraw"]),
    amount: z.string().optional().describe("Dollars for deposit or withdraw."),
  }),
  run: (args) => runOnDesk("move-usdc", args),
});
