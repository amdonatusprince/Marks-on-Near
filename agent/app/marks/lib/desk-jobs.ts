export type DeskJobStatus = "waiting" | "signing" | "done" | "error";

export type DeskJob = {
  id: string;
  name: string;
  status: DeskJobStatus;
  result?: unknown;
  error?: string;
};

const jobs = new Map<string, DeskJob>();
let seq = 0;

function reason(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught);
}

/** Start chain work without holding the agent's browser-session request open. */
export function startDeskJob(
  name: string,
  work: (signing: () => void) => Promise<unknown>,
) {
  const id = `job-${++seq}-${Date.now()}`;
  const job: DeskJob = { id, name, status: "waiting" };
  jobs.set(id, job);
  void work(() => {
    job.status = "signing";
  })
    .then((result) => {
      job.status = "done";
      job.result = result;
    })
    .catch((caught) => {
      job.status = "error";
      job.error = reason(caught);
    });
  return id;
}

export function deskJob(id?: string) {
  if (id) return jobs.get(id) ?? null;
  let latest: DeskJob | null = null;
  for (const job of jobs.values()) latest = job;
  return latest;
}
