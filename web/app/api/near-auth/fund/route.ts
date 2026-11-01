import { runScript } from "@/lib/auth-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMPLICIT = /^[0-9a-f]{64}$/;

export async function POST(request: Request) {
  let accountId = "";
  try {
    const body = (await request.json()) as { accountId?: string };
    accountId = body.accountId ?? "";
  } catch {
    return Response.json({ error: "The account id was not valid JSON" }, { status: 400 });
  }
  if (!IMPLICIT.test(accountId)) {
    return Response.json(
      { error: "The Google account id is not an implicit account" },
      { status: 400 },
    );
  }
  try {
    const stdout = await runScript("auth-fund.sh", [accountId], 120_000);
    return Response.json({ status: stdout.includes("FUNDED") ? "funded" : "ready" });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Could not fund the Google account";
    return Response.json({ error: message }, { status: 502 });
  }
}
