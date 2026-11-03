import "./buffer-polyfill";

import { FastAuthClient, FastAuthSignature } from "@fast-auth-near/browser-sdk";
import { Auth0Client } from "@auth0/auth0-spa-js";
import { connect, keyStores } from "near-api-js";
import { createTransaction, encodeTransaction, functionCall } from "near-api-js/lib/transaction";
import { PublicKey } from "near-api-js/lib/utils";
import { base_decode } from "near-api-js/lib/utils/serialize";
import jwtDecode from "jwt-decode";
import { rpcUrl } from "@/lib/network";

const CLIENT_ID = "np8paqIpMWmNbzT4xAvOOapZBjsOpptl";
const DOMAIN = "login.testnet.fast-auth.com";
const SIGNING_AUDIENCE = "auth0.jwt.fast-auth.testnet";
const GUARD_ID = `jwt#https://${DOMAIN}/`;
const MARKS_GAS = BigInt("30000000000000");

type Claims = { sub?: string; fatxn?: number[] | string };

type SignatureRequest = {
  guardId: string;
  verifyPayload: string;
  signPayload: ArrayLike<number>;
};

class GoogleProvider {
  private client: Auth0Client | null = null;

  private auth() {
    if (typeof window === "undefined") {
      throw new Error("Google sign-in runs in the browser");
    }
    this.client ??= new Auth0Client({
      domain: DOMAIN,
      clientId: CLIENT_ID,
      cacheLocation: "localstorage",
      authorizationParams: { redirect_uri: window.location.origin },
    });
    return this.client;
  }

  async isLoggedIn() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("code") && params.get("state")) {
        await this.auth().handleRedirectCallback();
        window.history.replaceState({}, document.title, window.location.pathname);
        return true;
      }
    } catch {
      return false;
    }
    return this.auth().isAuthenticated();
  }

  async login() {
    try {
      await this.auth().loginWithPopup({ authorizationParams: {} });
    } catch (caught) {
      if (!popupBlocked(caught)) throw caught;
      await this.auth().loginWithRedirect({
        authorizationParams: { redirect_uri: window.location.origin },
      });
      return new Promise<{ userId: string }>(() => undefined);
    }
    const claims = await this.auth().getIdTokenClaims();
    if (!claims?.sub) throw new Error("Google sign-in did not return an account");
    return { userId: claims.sub };
  }

  async logout() {
    if (!this.client) return;
    await this.client.logout({ openUrl: false });
  }

  async getPath() {
    const claims = await this.auth().getIdTokenClaims();
    if (!claims?.sub) throw new Error("Google sign-in did not return an account");
    return `${GUARD_ID}#${claims.sub}`;
  }

  async requestTransactionSignature(options: {
    transaction: Parameters<typeof encodeTransaction>[0];
  }) {
    const transaction = Array.from(encodeTransaction(options.transaction));
    await this.auth().loginWithPopup({
      authorizationParams: {
        audience: SIGNING_AUDIENCE,
        scope: "transaction:sign",
        transaction,
      } as { audience: string; scope: string },
    });
    return this.user();
  }

  async getSignatureRequest(): Promise<{ signatureRequest: SignatureRequest }> {
    const token = await this.auth().getTokenSilently({
      authorizationParams: { audience: SIGNING_AUDIENCE },
    });
    if (!token) throw new Error("NEAR Auth did not return an approval for this order");
    const claims = jwtDecode<Claims>(token);
    if (!claims.fatxn) throw new Error("NEAR Auth did not return an approval for this order");
    const signPayload = Array.isArray(claims.fatxn)
      ? claims.fatxn
      : Array.from(claims.fatxn, (char) => char.charCodeAt(0));
    const user = await this.user();
    return {
      signatureRequest: {
        guardId: GUARD_ID,
        verifyPayload: token,
        signPayload,
      },
      ...user,
    };
  }

  private async user() {
    const claims = await this.auth().getIdTokenClaims();
    if (!claims?.sub) throw new Error("Google sign-in did not return an account");
    return { userId: claims.sub };
  }
}

const provider = new GoogleProvider();
let nearPromise: ReturnType<typeof connect> | null = null;
let clientPromise: Promise<InstanceType<typeof FastAuthClient>> | null = null;
let fundedFor = "";
let funding: Promise<void> | null = null;

function near() {
  nearPromise ??= connect({
    networkId: "testnet",
    nodeUrl: rpcUrl("testnet"),
    keyStore: new keyStores.InMemoryKeyStore(),
  });
  return nearPromise;
}

async function client() {
  clientPromise ??= near().then(
    (connection) =>
      new FastAuthClient(provider as never, connection.connection, {
        fastAuthContractId: "fast-auth.testnet",
        mpcContractId: "v1.signer-prod.testnet",
      }),
  );
  return clientPromise;
}

function asPublicKey(value: unknown) {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (!text.startsWith("ed25519:")) throw new Error("Could not read the Google account key");
  return PublicKey.fromString(text);
}

function implicitAccount(key: PublicKey) {
  return Array.from(key.data, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function accountFromSession() {
  const signer = await (await client()).getSigner();
  return implicitAccount(asPublicKey(await signer.getPublicKey()));
}

export async function loginGoogle() {
  await provider.login();
  return accountFromSession();
}

export async function restoreGoogleAccount() {
  if (typeof window === "undefined") return null;
  if (!(await provider.isLoggedIn())) return null;
  return accountFromSession();
}

export async function logoutGoogle() {
  fundedFor = "";
  funding = null;
  await provider.logout();
}

export function ensureGoogleFunded(accountId: string) {
  if (fundedFor === accountId && funding) return funding;
  fundedFor = accountId;
  funding = fetch("/api/near-auth/fund", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId }),
  }).then(async (response) => {
    if (response.ok) return;
    funding = null;
    fundedFor = "";
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "Could not fund the Google account");
  });
  return funding;
}

async function accessKey(accountId: string, publicKey: string) {
  const connection = await near();
  let last = "The Google account is not on testnet yet";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await connection.connection.provider.query({
        request_type: "view_access_key",
        finality: "final",
        account_id: accountId,
        public_key: publicKey,
      });
    } catch (caught) {
      last = caught instanceof Error ? caught.message : last;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(last);
}

export async function googleSend(
  methodName: string,
  args: object,
  receiverId: string,
  gas: bigint = MARKS_GAS,
  deposit: bigint = BigInt(0),
) {
  return googleSendActions(receiverId, [functionCall(methodName, args, gas, deposit)]);
}

export async function googleSendActions(
  receiverId: string,
  actions: ReturnType<typeof functionCall>[],
) {
  if (!receiverId) throw new Error("NEXT_PUBLIC_CONTRACT_ID is not set");
  if (actions.length === 0) throw new Error("The transaction has no actions");
  const signer = await (await client()).getSigner();
  const publicKey = asPublicKey(await signer.getPublicKey());
  const accountId = implicitAccount(publicKey);
  await ensureGoogleFunded(accountId);
  const key = (await accessKey(accountId, publicKey.toString())) as unknown as {
    nonce: number | string;
  };
  const connection = await near();
  const block = await connection.connection.provider.block({ finality: "final" });
  const transaction = createTransaction(
    accountId,
    publicKey,
    receiverId,
    BigInt(key.nonce) + BigInt(1),
    actions,
    base_decode(block.header.hash),
  );
  await signer.requestTransactionSignature({ transaction });
  const requested = (await signer.getSignatureRequest()) as {
    signatureRequest?: SignatureRequest;
  };
  const signatureRequest = requested.signatureRequest;
  if (!signatureRequest?.verifyPayload) {
    throw new Error("NEAR Auth did not return an approval for this order");
  }
  const response = await fetch("/api/near-auth/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      guardId: signatureRequest.guardId,
      verifyPayload: signatureRequest.verifyPayload,
      signPayload: Array.from(signatureRequest.signPayload, (byte) => Number(byte)),
      algorithm: "eddsa",
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    successValue?: string;
  };
  if (!response.ok || !body.successValue) {
    throw new Error(body.error || "Could not sign with NEAR Auth");
  }
  const outcome = (await signer.sendTransaction(
    transaction,
    FastAuthSignature.fromBase64(body.successValue),
    "ed25519",
  )) as { transaction?: { hash?: string } };
  return outcome.transaction?.hash ?? "";
}

export function googleClosed(caught: unknown) {
  const message = caught instanceof Error ? caught.message : "";
  return /user closed|popup closed|cancelled|canceled|rejected/i.test(message);
}

function popupBlocked(caught: unknown) {
  const message = caught instanceof Error ? caught.message : "";
  return /unable to open|blocked|timeout/i.test(message);
}
