import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { runOnDesk } from "../server/marks/desk-tab";

export default defineAction({
  description:
    'Send a Marks gift link from the person\'s account. Cash: amount only ("50" for $50 USDC). Stock: assetId (nvda) plus amount in dollars. Perp position: symbol (SOL-PERP) only. A card opens on the Marks tab; they press Open wallet and sign. Returns jobId; poll check-desk-job until result.link.',
  schema: z.object({
    amount: z
      .string()
      .optional()
      .describe('Dollars for cash or stock gifts, such as "50".'),
    assetId: z
      .string()
      .optional()
      .describe("Share id for a stock gift, such as nvda. Leave out for cash."),
    symbol: z
      .string()
      .optional()
      .describe(
        "Perp market for a position gift, such as SOL-PERP. Leave out for cash.",
      ),
    days: z
      .union([z.literal(7), z.literal(30), z.literal(90)])
      .optional()
      .describe("How long the link stays open. Default 30."),
    note: z.string().optional().describe("Optional note sealed into the link."),
  }),
  run: (args) => runOnDesk("send-gift", args),
});
