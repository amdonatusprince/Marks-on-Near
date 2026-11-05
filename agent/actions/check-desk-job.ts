import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { runOnDesk, runOnEveryDesk } from "../server/marks/desk-tab";

const WAIT_MS = 50_000;
const POLL_MS = 2_000;

type Job = { ok?: boolean; jobId?: string; status?: string };

const pending = (job: unknown) => {
  const status = (job as Job | null)?.status;
  return status === "waiting" || status === "signing";
};

/** Job ids end in their start time, so the newest job sorts last. */
const startedAt = (job: Job) => Number(job.jobId?.split("-").pop()) || 0;

/** Without a jobId, the live job may sit in any open Marks tab. */
async function latestJobId() {
  const jobs = (await runOnEveryDesk("check-desk-job", {})) as Job[];
  const found = jobs
    .filter((job) => job?.ok && job.jobId)
    .sort(
      (a, b) =>
        Number(pending(b)) - Number(pending(a)) || startedAt(b) - startedAt(a),
    )[0];
  return found?.jobId;
}

export default defineAction({
  description:
    "Wait for a write started on the Marks tab. Always pass the jobId the write returned. Holds up to 50 seconds while the card is up or the wallet is open, then returns. done: result has tx, explorer and, for gifts, link. error: read error. Still waiting or signing: call again with the same jobId.",
  schema: z.object({
    jobId: z
      .string()
      .optional()
      .describe("jobId returned by the write, passed back exactly."),
  }),
  readOnly: true,
  dedupe: false,
  run: async (args) => {
    const jobId = args.jobId || (await latestJobId());
    if (!jobId) return { ok: false, status: "missing" };
    const deadline = Date.now() + WAIT_MS;
    let job = await runOnDesk("check-desk-job", { jobId });
    while (pending(job) && Date.now() + POLL_MS < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      job = await runOnDesk("check-desk-job", { jobId });
    }
    return job;
  },
});
