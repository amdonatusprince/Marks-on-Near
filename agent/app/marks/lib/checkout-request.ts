/** USDC on NEAR, the asset a Marks checkout delivers to the merchant. */
export const NEAR_USDC =
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

/** One invoice, in USDC atoms. Larger checkouts go through the merchant's own 1Click key. */
export const MAX_INVOICE_ATOMS = BigInt(10_000_000_000);

const NEAR_ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export type OriginToken = {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  /** How a wallet pays this chain. NEAR has no scan-to-pay link. */
  kind: "solana" | "evm" | "near";
  /** EVM chain id, used in the MetaMask payment link. */
  chainId?: number | undefined;
  /** SPL mint or ERC-20 contract the wallet must send. */
  contract?: string | undefined;
};

/** USDC on chains a wallet can pay. The server drops any id 1Click no longer lists. */
export const ORIGINS: OriginToken[] = [
  {
    assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
    symbol: "USDC",
    blockchain: "Solana",
    decimals: 6,
    kind: "solana",
    contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  {
    assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
    symbol: "USDC",
    blockchain: "Ethereum",
    decimals: 6,
    kind: "evm",
    chainId: 1,
    contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  },
  {
    assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
    symbol: "USDC",
    blockchain: "Arbitrum",
    decimals: 6,
    kind: "evm",
    chainId: 42161,
    contract: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  },
  {
    assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
    symbol: "USDC",
    blockchain: "Base",
    decimals: 6,
    kind: "evm",
    chainId: 8453,
    contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  },
  {
    assetId: "nep245:v2_1.omni.hot.tg:10_A2ewyUyDp6qsue1jqZsGypkCxRJ",
    symbol: "USDC",
    blockchain: "Optimism",
    decimals: 6,
    kind: "evm",
    chainId: 10,
    contract: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
  },
  {
    assetId: "nep141:pol-0x3c499c542cef5e3811e1192ce70d8cc03d5c3359.omdep.near",
    symbol: "USDC",
    blockchain: "Polygon",
    decimals: 6,
    kind: "evm",
    chainId: 137,
    contract: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
  },
  {
    assetId:
      "nep141:avax-0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e.omdep.near",
    symbol: "USDC",
    blockchain: "Avalanche",
    decimals: 6,
    kind: "evm",
    chainId: 43114,
    contract: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
  },
  {
    assetId: "nep141:bnb-0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d.omdep.near",
    symbol: "USDC",
    blockchain: "BNB Chain",
    decimals: 18,
    kind: "evm",
    chainId: 56,
    contract: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
  },
  {
    assetId:
      "nep141:gnosis-0x2a22f9c3b484c3629090feed35f17ff8f88f76f0.omft.near",
    symbol: "USDC",
    blockchain: "Gnosis",
    decimals: 6,
    kind: "evm",
    chainId: 100,
    contract: "0x2a22f9c3b484c3629090feed35f17ff8f88f76f0",
  },
  {
    assetId: NEAR_USDC,
    symbol: "USDC",
    blockchain: "NEAR",
    decimals: 6,
    kind: "near",
  },
];

export function invoiceAtoms(text: string) {
  const trimmed = text.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d*)?$/.test(trimmed)) return null;
  const [whole = "0", frac = ""] = trimmed.split(".");
  const digits = `${frac}000000`.slice(0, 6);
  const atoms = BigInt(whole) * BigInt(1_000_000) + BigInt(digits);
  return atoms > BigInt(0) ? atoms : null;
}

export function nearAccount(value: string) {
  const account = value.trim().toLowerCase();
  if (account.length < 2 || account.length > 64) return null;
  return NEAR_ACCOUNT.test(account) ? account : null;
}

export function refundAddress(value: string) {
  const address = value.trim();
  if (address.length < 2 || address.length > 128 || /\s/.test(address))
    return null;
  return address;
}

/** A wallet scan link for this deposit. The amount is in the code, so the wallet fills it in. Callers skip it when a memo is required. */
export function payLink(token: OriginToken, deposit: string, amountIn: string) {
  const amount = formatToken(amountIn, token.decimals);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount)) return null;
  const wallets = `Scan with ${token.blockchain} supported wallet`;
  if (token.kind === "solana" && token.contract) {
    const query = [
      `amount=${amount}`,
      `spl-token=${token.contract}`,
      `label=${encodeURIComponent("Marks")}`,
      `message=${encodeURIComponent(`Pay ${amount} ${token.symbol}`)}`,
    ].join("&");
    return { uri: `solana:${deposit}?${query}`, wallets, amount };
  }
  if (
    token.kind === "evm" &&
    token.contract &&
    token.chainId &&
    /^0x[a-fA-F0-9]{40}$/.test(deposit) &&
    /^\d+$/.test(amountIn)
  ) {
    return {
      uri: `ethereum:${token.contract}@${token.chainId}/transfer?address=${deposit}&uint256=${amountIn}`,
      wallets,
      amount,
    };
  }
  return null;
}

export function formatToken(amount: string, decimals: number) {
  const value = BigInt(amount);
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = value / scale;
  const frac = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return frac ? `${whole.toString()}.${frac}` : whole.toString();
}

export type PaymentIntent = {
  depositAddress: string;
  expiresAt: string;
  amountIn?: string | undefined;
  amountInFormatted?: string | undefined;
  depositMemo?: string | null | undefined;
  originAsset?: string | undefined;
  pay?: { wallets: string; image: string } | null | undefined;
};

export type PaymentStatus = "waiting" | "processing" | "paid" | "failed";

/** What a person should read. A passed quote deadline is expired even while settlement still says processing. */
export function paymentStanding(payment: {
  status: PaymentStatus;
  expiresAt?: string | undefined;
}): PaymentStatus | "expired" {
  if (payment.status === "paid" || payment.status === "failed") {
    return payment.status;
  }
  if (payment.expiresAt) {
    const end = Date.parse(payment.expiresAt);
    if (!Number.isNaN(end) && end <= Date.now()) return "expired";
  }
  return payment.status;
}

/** A payment link. The id is the only thing in the URL. */
export type PaymentRecord = {
  id: string;
  amount: string;
  atoms: string;
  recipient: string;
  status: PaymentStatus;
  createdAt: string;
  expiresAt?: string | undefined;
};

export function paymentPath(id: string) {
  return `/checkout/${id}`;
}

export function checkoutBody(input: {
  dry: boolean;
  originAsset: string;
  amount: string;
  recipient: string;
  refundTo: string;
}) {
  return {
    dry: input.dry,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
    originAsset: input.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: NEAR_USDC,
    amount: input.amount,
    recipient: input.recipient,
    recipientType: "DESTINATION_CHAIN",
    refundTo: input.refundTo,
    refundType: "ORIGIN_CHAIN",
    deadline: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
  };
}
