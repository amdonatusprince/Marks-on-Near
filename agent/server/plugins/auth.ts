import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

export default createToolkitAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  rootAuth: false,
  marketing: false,
  publicPaths: [
    "/api/candles",
    "/api/faucet",
    "/api/gift",
    "/api/gift/links",
    "/api/near-auth",
    "/api/quote",
    "/api/checkout/quote",
    "/api/checkout/status",
    "/api/checkout/tokens",
    "/api/checkout/links",
    "/api/checkout/paid",
  ],
});
