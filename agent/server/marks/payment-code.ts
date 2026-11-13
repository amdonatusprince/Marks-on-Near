import { createRequire } from "node:module";

import { ORIGINS, payLink } from "../../app/marks/lib/checkout-request";

const qrcode = createRequire(import.meta.url)("qrcode") as {
  toString(text: string, options: Record<string, unknown>): Promise<string>;
};

/** A wallet QR for a live deposit. A memo cannot ride along in the scan. */
export async function paymentCode(
  originAsset: string,
  depositAddress: string,
  amountIn: string,
  depositMemo?: string | null | undefined,
) {
  if (!depositAddress || !amountIn || depositMemo) return null;
  const token = ORIGINS.find((item) => item.assetId === originAsset);
  const link = token ? payLink(token, depositAddress, amountIn) : null;
  if (!link) return null;
  try {
    const svg = await qrcode.toString(link.uri, {
      type: "svg",
      margin: 1,
      width: 220,
      color: { dark: "#0e0809", light: "#f6efe6" },
    });
    return {
      wallets: `${link.wallets}. It fills in ${link.amount} ${token?.symbol ?? "USDC"}.`,
      image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    };
  } catch {
    return null;
  }
}
