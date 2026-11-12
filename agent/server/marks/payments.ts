import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import type {
  PaymentRecord,
  PaymentStatus,
} from "../../app/marks/lib/checkout-request";
import { repoRoot } from "./auth-script";

export type StoredPayment = PaymentRecord & {
  depositAddress?: string | undefined;
  originAsset?: string | undefined;
  amountIn?: string | undefined;
  amountInFormatted?: string | undefined;
  depositMemo?: string | null | undefined;
};

type Store = { payments: StoredPayment[] };

const empty = (): Store => ({ payments: [] });

let tail: Promise<unknown> = Promise.resolve();

function file() {
  return path.join(repoRoot(), "agent", "data", "payments.json");
}

async function read(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(file(), "utf8")) as Partial<Store>;
    return { payments: Array.isArray(parsed.payments) ? parsed.payments : [] };
  } catch {
    return empty();
  }
}

async function write(store: Store) {
  const target = file();
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(store), { mode: 0o600 });
}

function locked<T>(fn: (store: Store) => Promise<T> | T) {
  const run = tail.then(async () => {
    const store = await read();
    const result = await fn(store);
    await write(store);
    return result;
  });
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function publicPayment(row: StoredPayment): PaymentRecord {
  return {
    id: row.id,
    amount: row.amount,
    atoms: row.atoms,
    recipient: row.recipient,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

export function newPaymentId() {
  return randomBytes(12).toString("base64url");
}

export function paymentIdOk(id: string) {
  return /^[A-Za-z0-9_-]{16}$/.test(id);
}

export function intentStanding(status: string): PaymentStatus | null {
  if (status === "SUCCESS") return "paid";
  if (
    status === "REFUNDED" ||
    status === "FAILED" ||
    status === "INCOMPLETE_DEPOSIT"
  ) {
    return "failed";
  }
  if (
    status === "PENDING_DEPOSIT" ||
    status === "KNOWN_DEPOSIT_TX" ||
    status === "PROCESSING"
  ) {
    return "processing";
  }
  return null;
}

export async function createPayment(input: {
  amount: string;
  atoms: string;
  recipient: string;
}) {
  const row: StoredPayment = {
    id: newPaymentId(),
    amount: input.amount,
    atoms: input.atoms,
    recipient: input.recipient,
    status: "waiting",
    createdAt: new Date().toISOString(),
  };
  await locked((store) => {
    store.payments.push(row);
  });
  return row;
}

export async function readPayment(id: string) {
  const store = await read();
  return store.payments.find((row) => row.id === id) ?? null;
}

export async function listPayments(recipient: string) {
  const store = await read();
  return store.payments
    .filter((row) => row.recipient === recipient)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 50);
}

export async function markQuoted(
  id: string,
  input: {
    depositAddress: string;
    expiresAt: string;
    originAsset: string;
    amountIn?: string | undefined;
    amountInFormatted?: string | undefined;
    depositMemo?: string | null | undefined;
  },
) {
  return locked((store) => {
    const row = store.payments.find((item) => item.id === id);
    if (!row || row.status === "paid") return null;
    if (row.depositAddress && row.depositAddress !== input.depositAddress) {
      return row;
    }
    row.status = "processing";
    row.depositAddress = input.depositAddress;
    row.expiresAt = input.expiresAt;
    row.originAsset = input.originAsset;
    row.amountIn = input.amountIn;
    row.amountInFormatted = input.amountInFormatted;
    row.depositMemo = input.depositMemo;
    return row;
  });
}

/** Apply a 1Click status only when the deposit address is the one this link issued. */
export async function markIntent(
  id: string,
  depositAddress: string,
  intentStatus: string,
) {
  const next = intentStanding(intentStatus);
  if (!next) return null;
  return locked((store) => {
    const row = store.payments.find((item) => item.id === id);
    if (
      !row ||
      row.depositAddress !== depositAddress ||
      row.status === "paid"
    ) {
      return null;
    }
    row.status = next;
    return row;
  });
}

export async function markPaid(id: string) {
  return locked((store) => {
    const row = store.payments.find((item) => item.id === id);
    if (!row || row.status === "paid") return row ?? null;
    row.status = "paid";
    return row;
  });
}
