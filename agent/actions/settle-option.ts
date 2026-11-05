import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { runOnDesk } from "../server/marks/desk-tab";

export default defineAction({
  description:
    "Settle an expired series if needed, then claim the payout, same as /stocks. Returns jobId; poll check-desk-job.",
  schema: z.object({ seriesId: z.string() }),
  run: (args) => runOnDesk("settle-option", args),
});
