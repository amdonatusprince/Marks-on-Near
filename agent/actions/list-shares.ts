import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { seriesTitle, type Series, type Share } from "../app/marks/lib/v2";
import { money, viewChain } from "../shared/marks";

export default defineAction({
  description:
    "List Marks share assets and capped-call series: oracle price, ticker, and each live series id for place-option. Reads the chain directly.",
  schema: z.object({
    assetId: z
      .string()
      .optional()
      .describe("Only this share id, such as nvda. Omit to list every share."),
  }),
  readOnly: true,
  mcpTool: true,
  run: async ({ assetId }) => {
    const wanted = assetId?.trim().toLowerCase();
    const [shares, series] = await Promise.all([
      viewChain<Share[]>("get_shares"),
      viewChain<Series[]>("get_series_list").catch(() => [] as Series[]),
    ]);
    return {
      shares: shares
        .filter((share) => !wanted || share.asset_id === wanted)
        .map((share) => ({
          assetId: share.asset_id,
          name: share.name,
          price: money(share.price),
        })),
      series: series
        .filter((item) => !wanted || item.asset_id === wanted)
        .map((item) => ({
          seriesId: item.id,
          assetId: item.asset_id,
          title: seriesTitle(item),
          expiryNs: item.expiry_ns,
          settled: Boolean(item.settle_price),
        })),
    };
  },
});
