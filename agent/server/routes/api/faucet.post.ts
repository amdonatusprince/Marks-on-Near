import { defineEventHandler } from "h3";
import { redact, runScript } from "../../marks/auth-script";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

const ACCOUNT =
  /^(?=.{2,64}$)([a-z0-9]+[-_])*[a-z0-9]+(\.([a-z0-9]+[-_])*[a-z0-9]+)*$/;

/** Claim 1,000 mUSDC for an account. The token allows each account one claim a day. */
async function post(request: Request) {
  let account: unknown;
  try {
    account = ((await request.json()) as { account_id?: unknown }).account_id;
  } catch {
    return Response.json(
      { error: "The request was not valid JSON" },
      { status: 400 },
    );
  }
  if (typeof account !== "string" || !ACCOUNT.test(account)) {
    return Response.json(
      { error: "That account id is not valid" },
      { status: 400 },
    );
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "marks-faucet-"));
  const file = path.join(dir, "args.json");
  try {
    await writeFile(file, JSON.stringify({ account_id: account }));
    const stdout = await runScript("relay.sh", ["faucet", file], 120_000);
    const hash = stdout.match(/HASH\s+([A-Za-z0-9]+)/)?.[1];
    if (!hash)
      return Response.json(
        { error: "The faucet returned no hash" },
        { status: 502 },
      );
    return Response.json({ hash });
  } catch (caught) {
    const message =
      caught instanceof Error ? redact(caught.message) : "The faucet failed";
    // near-cli prints the contract's "faucet cooldown" panic as a bare
    // unreachable trap, with no logs. That is the only panic in this method.
    // near-cli wraps the trap as `unreachable` opcode, with a backtick in the
    // middle, so the words are not adjacent.
    const status = /cooldown|unreachable/.test(message) ? 429 : 502;
    return Response.json(
      {
        error: status === 429 ? "This account already claimed today" : message,
      },
      { status },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export default defineEventHandler((event) => post(event.req));
