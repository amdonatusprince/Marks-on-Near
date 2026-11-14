import { defineEventHandler } from "h3";

import { readGiftLinks, storeGiftLinks } from "../../../marks/gift-links";

const ACCOUNT =
  /^(?=.{2,64}$)([a-z0-9]+[-_])*[a-z0-9]+(\.([a-z0-9]+[-_])*[a-z0-9]+)*$/;

type Body = {
  op?: string;
  accountId?: string;
  publicKey?: string;
  signature?: string;
  nonce?: string;
  links?: Record<string, string>;
};

async function post(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;
  if (
    !body ||
    !body.accountId ||
    !ACCOUNT.test(body.accountId) ||
    !body.publicKey ||
    !body.signature ||
    !body.nonce
  ) {
    return Response.json(
      { error: "The gift link request is incomplete" },
      { status: 400 },
    );
  }
  try {
    if (body.op === "store") {
      await storeGiftLinks({
        accountId: body.accountId,
        publicKey: body.publicKey,
        signature: body.signature,
        nonce: body.nonce,
        links: body.links ?? {},
      });
      return Response.json({ ok: true });
    }
    if (body.op === "read") {
      const links = await readGiftLinks({
        accountId: body.accountId,
        publicKey: body.publicKey,
        signature: body.signature,
        nonce: body.nonce,
      });
      return Response.json({ links });
    }
    return Response.json(
      { error: "Unknown gift link request" },
      { status: 400 },
    );
  } catch (caught) {
    const error =
      caught instanceof Error ? caught.message : "The gift links failed";
    return Response.json({ error }, { status: 400 });
  }
}

export default defineEventHandler((event) => post(event.req));
