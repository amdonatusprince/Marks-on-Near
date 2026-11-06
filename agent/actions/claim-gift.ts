import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { runOnDesk } from "../server/marks/desk-tab";

export default defineAction({
  description:
    "Claim an open gift into the signed-in account, same as Open on the gift link. Pass link only when they pasted the full URL. Otherwise the gift link is already open on the Marks tab and the secret stays in the address bar. Returns jobId; poll check-desk-job. Never repeat the secret or the hash.",
  schema: z.object({
    link: z
      .string()
      .optional()
      .describe(
        "Full gift URL including the #secret, only when they pasted it in chat.",
      ),
  }),
  run: async ({ link }) => runOnDesk("claim-gift", { link }),
});
