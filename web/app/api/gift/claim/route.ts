import { redact, runScript } from "@/lib/auth-script";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCOUNT = /^(?=.{2,64}$)([a-z0-9]+[-_])*[a-z0-9]+(\.([a-z0-9]+[-_])*[a-z0-9]+)*$/;
const SIGNATURE = /^[0-9a-f]{128}$/;

type Body = { gift_id?: number; recipient?: string; signature?: string };

/**
 * Submit a claim the recipient's browser signed with the link key. The relayer pays gas and can
 * change nothing: the contract checks the signature over this gift id and this recipient.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "The claim was not valid JSON" }, { status: 400 });
  }
  const valid =
    Number.isSafeInteger(body.gift_id) &&
    (body.gift_id ?? -1) >= 0 &&
    typeof body.recipient === "string" &&
    ACCOUNT.test(body.recipient) &&
    typeof body.signature === "string" &&
    SIGNATURE.test(body.signature);
  if (!valid) return Response.json({ error: "The claim was rejected" }, { status: 400 });

  const dir = await mkdtemp(path.join(os.tmpdir(), "marks-claim-"));
  const file = path.join(dir, "args.json");
  try {
    await writeFile(
      file,
      JSON.stringify({
        gift_id: body.gift_id,
        recipient: body.recipient,
        signature: body.signature,
      }),
    );
    const stdout = await runScript("relay.sh", ["gift-claim", file], 120_000);
    const hash = stdout.match(/HASH\s+([A-Za-z0-9]+)/)?.[1];
    if (!hash) return Response.json({ error: "The claim returned no hash" }, { status: 502 });
    return Response.json({ hash });
  } catch (caught) {
    const message = caught instanceof Error ? redact(caught.message) : "The claim failed";
    return Response.json({ error: message }, { status: 502 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
