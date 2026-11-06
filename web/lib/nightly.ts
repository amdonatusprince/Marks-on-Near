import { rpcUrl, type Network } from "@/lib/network";

type SignedTransaction = { encode?: () => Uint8Array };

type NightlyNear = {
  signTransaction: (transaction: unknown, send?: boolean) => Promise<unknown>;
  __marks?: boolean;
};

type Outcome = {
  transaction?: { hash?: string };
  status?: { Failure?: unknown; SuccessValue?: string };
};

let network: Network = "testnet";

/** The patched Nightly call broadcasts on this network, which is the one the app is showing. */
export function setNightlyNetwork(next: Network) {
  network = next;
}

/**
 * Nightly's `signTransaction(tx, true)` signs, then broadcasts through its own
 * provider list. Those nodes answer `send_tx` with method-not-found, the
 * wallet retries until the block hash expires, and the page never leaves
 * "Sending". Signing with `false` returns the signed transaction. Marks
 * broadcasts that on FastNEAR, which accepts `send_tx`.
 */
export function installNightlyRelay() {
  const near = (window as Window & { nightly?: { near?: NightlyNear } }).nightly?.near;
  if (!near || near.__marks) return;
  const original = near.signTransaction.bind(near);
  near.signTransaction = async (transaction, send) => {
    const signed = (await original(transaction, false)) as SignedTransaction;
    if (!send) return signed;
    return broadcast(signed);
  };
  near.__marks = true;
}

async function broadcast(signed: SignedTransaction) {
  if (typeof signed.encode !== "function") {
    throw new Error("Nightly did not return a signed transaction");
  }
  const response = await fetch(rpcUrl(network), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "marks",
      method: "send_tx",
      params: { signed_tx_base64: base64(signed.encode()), wait_until: "EXECUTED" },
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; data?: unknown };
    result?: Outcome;
  };
  if (body.error || !body.result) {
    const data = body.error?.data;
    const detail = typeof data === "string" ? data : body.error?.message;
    throw new Error(detail || "The transaction was rejected");
  }
  if (body.result.status && "Failure" in body.result.status) {
    throw new Error(failureText(body.result.status.Failure));
  }
  return body.result;
}

function failureText(failure: unknown) {
  const text = JSON.stringify(failure);
  const panic = text.match(/Smart contract panicked: ([^"]+)/);
  return panic?.[1] ?? "The transaction failed";
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
