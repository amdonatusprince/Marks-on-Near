import { agentId, redact, runScript } from "@/lib/auth-script";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GUARD_ID = "jwt#https://login.testnet.fast-auth.com/";
const JWT = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

type Body = {
  guardId?: string;
  verifyPayload?: string;
  signPayload?: number[];
  algorithm?: string;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "The signature request was not valid JSON" }, { status: 400 });
  }
  const payload = body.signPayload ?? [];
  const valid =
    body.guardId === GUARD_ID &&
    typeof body.verifyPayload === "string" &&
    JWT.test(body.verifyPayload) &&
    body.verifyPayload.length < 20_000 &&
    body.algorithm === "eddsa" &&
    payload.length > 0 &&
    payload.length < 100_000 &&
    payload.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);
  if (!valid) {
    return Response.json({ error: "The signature request was rejected" }, { status: 400 });
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), "marks-auth-"));
  const file = path.join(dir, "args.json");
  try {
    await writeFile(
      file,
      JSON.stringify({
        guard_id: body.guardId,
        verify_payload: body.verifyPayload,
        sign_payload: payload,
        algorithm: "eddsa",
      }),
    );
    const stdout = await runScript("auth-sign.sh", [file], 180_000);
    const hash = stdout.match(/HASH\s+([A-Za-z0-9]+)/)?.[1];
    if (!hash)
      return Response.json(
        { error: "The signature transaction did not return a hash" },
        { status: 502 },
      );
    const successValue = await signatureOf(hash, await agentId());
    return Response.json({ hash, successValue });
  } catch (caught) {
    const message =
      caught instanceof Error ? redact(caught.message) : "Could not sign with NEAR Auth";
    return Response.json({ error: message }, { status: 502 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function signatureOf(hash: string, sender: string) {
  const response = await fetch("https://rpc.testnet.near.org", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "marks",
      method: "EXPERIMENTAL_tx_status",
      params: { tx_hash: hash, sender_account_id: sender, wait_until: "EXECUTED" },
    }),
  });
  const body = (await response.json()) as {
    error?: { message?: string };
    result?: {
      status?: { SuccessValue?: string };
      receipts_outcome?: { outcome: { status: { SuccessValue?: string } } }[];
    };
  };
  if (body.error) throw new Error(body.error.message || "Could not read the signature transaction");
  const values = [
    body.result?.status?.SuccessValue,
    ...(body.result?.receipts_outcome ?? []).map((item) => item.outcome.status?.SuccessValue),
  ].filter((value): value is string => Boolean(value));
  for (const value of values.reverse()) {
    const text = Buffer.from(value, "base64").toString();
    if (text.includes("signature") || text.includes("big_r") || text.includes("scalar"))
      return value;
  }
  throw new Error("The signature transaction did not return a signature");
}
