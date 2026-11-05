import { rememberLink } from "@/marks/lib/gift-vault";
import { signMarksMessage } from "@/marks/lib/near";
import type { Network } from "@/marks/lib/network";

const SYNCED = "marks-gift-sync";

function digest(links: Record<string, string>) {
  return Object.keys(links)
    .sort()
    .map((id) => `${id} ${links[id]}`)
    .join("\n");
}

async function post(body: object) {
  const response = await fetch("/api/gift/links", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    links?: Record<string, string>;
  };
  if (!response.ok)
    throw new Error(payload.error || "The gift links were not saved");
  return payload.links ?? {};
}

/** Save this browser's claim links for the signed-in account, once per set of gifts. */
export async function publishGiftLinks(opts: {
  network: Network;
  account: string;
  links: Record<string, string>;
}) {
  const body = digest(opts.links);
  if (!body) return;
  const marker = Object.keys(opts.links).sort().join(",");
  if (sessionStorage.getItem(SYNCED) === marker) return;
  const proof = await signMarksMessage(
    opts.network,
    `Store Marks gift links\n${opts.account}\n${body}`,
  );
  if (proof.accountId !== opts.account) {
    throw new Error("The wallet signed for a different account");
  }
  await post({
    op: "store",
    accountId: opts.account,
    publicKey: proof.publicKey,
    signature: proof.signature,
    nonce: proof.nonce,
    links: opts.links,
  });
  sessionStorage.setItem(SYNCED, marker);
}

/** Pull claim links this account saved from another browser, then keep them here. */
export async function pullGiftLinks(opts: {
  network: Network;
  contract: string;
  account: string;
}) {
  const proof = await signMarksMessage(
    opts.network,
    `Read Marks gift links\n${opts.account}`,
  );
  if (proof.accountId !== opts.account) {
    throw new Error("The wallet signed for a different account");
  }
  const links = await post({
    op: "read",
    accountId: opts.account,
    publicKey: proof.publicKey,
    signature: proof.signature,
    nonce: proof.nonce,
  });
  for (const [id, link] of Object.entries(links)) {
    rememberLink(opts.contract, opts.account, Number(id), link);
  }
  return links;
}
