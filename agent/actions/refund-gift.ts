import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import type { Gift } from "../app/marks/lib/v2";
import { runOnDesk } from "../server/marks/desk-tab";
import { viewChain } from "../shared/marks";

export default defineAction({
  description:
    "Revoke an open gift the person sent, same as Revoke on /send. The link stops working and the asset comes back. The 1% fee stays paid. giftId from get-account. Returns jobId; poll check-desk-job.",
  schema: z.object({
    giftId: z.number().describe("Gift id from get-account."),
  }),
  run: async (args) => {
    const gift = await viewChain<Gift | null>("get_gift", {
      gift_id: args.giftId,
    });
    if (!gift)
      return { ok: false, error: `Gift ${args.giftId} does not exist.` };
    if (gift.status !== "open") {
      return {
        ok: false,
        error: `Gift ${args.giftId} is already ${gift.status}.`,
      };
    }
    return runOnDesk("refund-gift", args);
  },
});
