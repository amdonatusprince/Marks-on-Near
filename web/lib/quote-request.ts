export function quoteBody(recipient: string, dry: boolean) {
  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  return {
    dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
    depositType: "ORIGIN_CHAIN",
    destinationAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    amount: "1000000",
    recipient,
    recipientType: "DESTINATION_CHAIN",
    refundTo: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D",
    refundType: "ORIGIN_CHAIN",
    deadline,
  };
}
