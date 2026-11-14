import {
  callBrowserSession,
  getRequestRunContext,
  getRequestUserEmail,
  listBrowserSessions,
} from "@agent-native/core/server";

const DESK_TIMEOUT_MS = 25_000;
const JOB_TAB = "~";
const NO_DESK =
  "No Marks tab with a connected NEAR wallet is open. Ask them to keep the Marks tab open with the wallet signed in, then refresh that tab.";

type DeskSession = Awaited<ReturnType<typeof listBrowserSessions>>[number];

const activeAt = (session: DeskSession) => {
  const data = (
    session.context as { data?: { lastActiveAt?: unknown } } | undefined
  )?.data;
  return Number(data?.lastActiveAt) || 0;
};

/** A job lives in the tab that started it, so its id carries that tab's session. */
const tagJob = (result: unknown, sessionId: string) => {
  const jobId = (result as { jobId?: unknown } | null)?.jobId;
  if (typeof jobId !== "string" || jobId.includes(JOB_TAB)) return result;
  return { ...(result as object), jobId: `${sessionId}${JOB_TAB}${jobId}` };
};

/** Open Marks tabs that can run `name`, the one the person used last first. */
async function desksFor(name: string) {
  const owner = getRequestRunContext()?.owner ?? getRequestUserEmail();
  if (!owner) throw new Error("No signed-in Agent chat user for this run.");
  const sessions = await listBrowserSessions(owner, { limit: 10 });
  const desks = sessions
    .filter((session) => session.actions.some((action) => action.name === name))
    .sort((a, b) => activeAt(b) - activeAt(a) || b.lastSeenAt - a.lastSeenAt);
  return { owner, desks };
}

async function runOn(
  owner: string,
  desk: DeskSession,
  name: string,
  args: Record<string, unknown>,
) {
  const clean = Object.fromEntries(
    Object.entries(args).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  );
  const result = await callBrowserSession(
    owner,
    desk.sessionId,
    { type: "run-action", name, args: clean, timeoutMs: DESK_TIMEOUT_MS },
    { timeoutMs: DESK_TIMEOUT_MS },
  );
  return tagJob(result, desk.sessionId);
}

/**
 * Runs a client action on the person's open Marks tab with typed arguments.
 * The generic run-browser-session-action tool takes `args` as a free-form
 * object, which some model gateways strip to `{}`, so writes go through here.
 */
export async function runOnDesk(name: string, args: Record<string, unknown>) {
  const jobId = typeof args.jobId === "string" ? args.jobId : undefined;
  const [tab, job] = jobId?.includes(JOB_TAB)
    ? jobId.split(JOB_TAB, 2)
    : [undefined, jobId];
  const { owner, desks } = await desksFor(name);
  const desk = tab
    ? desks.find((session) => session.sessionId === tab)
    : desks[0];
  if (!desk) {
    throw new Error(
      tab
        ? "The Marks tab that started this job was closed or reloaded. Check the Portfolio page or the explorer for the result."
        : NO_DESK,
    );
  }
  return runOn(owner, desk, name, { ...args, jobId: job });
}

/** NEAR account signed in on the tab that `runOnDesk(name)` would use. */
export async function deskAccount(name: string) {
  const { desks } = await desksFor(name);
  const data = (
    desks[0]?.context as { data?: { accountId?: unknown } } | undefined
  )?.data;
  return typeof data?.accountId === "string" ? data.accountId : undefined;
}

/** Runs a client action on every open Marks tab; tabs that fail are skipped. */
export async function runOnEveryDesk(
  name: string,
  args: Record<string, unknown>,
) {
  const { owner, desks } = await desksFor(name);
  if (!desks.length) throw new Error(NO_DESK);
  const settled = await Promise.allSettled(
    desks.map((desk) => runOn(owner, desk, name, args)),
  );
  return settled.flatMap((entry) =>
    entry.status === "fulfilled" ? [entry.value] : [],
  );
}
