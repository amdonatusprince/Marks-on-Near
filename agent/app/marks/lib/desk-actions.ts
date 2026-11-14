import { defineClientAction } from "@agent-native/core/client/host";

import { fillTicket } from "@/marks/lib/agent-events";
import {
  prepareGift,
  submitGift,
  type SendGiftInput,
} from "@/marks/lib/create-gift";
import { notifyTraded } from "@/marks/lib/desk-live";
import { deskJob, startDeskJob } from "@/marks/lib/desk-jobs";
import {
  borrowAgainstShares,
  borrowOnPosition,
  buyShares,
  cancelOrder,
  claimFaucetByRelay,
  claimFaucetSelf,
  claimGift,
  claimSettlement,
  commitMargin,
  depositToMarks,
  payBill,
  placeOption,
  refreshMark,
  refreshShare,
  cancelGift,
  repayShareLoan,
  sellShares,
  settleSeries,
  withdrawFromMarks,
} from "@/marks/lib/desk-writes";
import {
  atomsFromDollars,
  money,
  sizedOrder,
  ticksFromDollars,
} from "@/marks/lib/format";
import type { ContractCall, SendOptions } from "@/marks/lib/near";
import { contractFor, tokenFor, type Network } from "@/marks/lib/network";
import type { OrderKind, Side } from "@/marks/lib/order-plan";
import { placeOrder } from "@/marks/lib/place-order";
import type { Market } from "@/marks/lib/rpc";
import { viewClient } from "@/marks/lib/rpc-client";
import {
  isFresh,
  shareTicker,
  units,
  unitsFromText,
  viewMarks,
  explorerTx,
  type Gift,
  type GiftAsset,
  type Series,
  type Share,
} from "@/marks/lib/v2";
import { claimSignature, openNote, publicKeyOf } from "@/marks/lib/gift-key";

export type Ticket = {
  symbol: string;
  side: Side;
  kind: OrderKind;
  price: string;
  amount: string;
};

export type AskCard = {
  title: string;
  rows: { label: string; value: string }[];
  hint?: string;
};

export type DeskLive = {
  account: string | null;
  ready: boolean;
  network: Network;
  send: (
    methodName: string,
    args: object,
    options?: SendOptions,
  ) => Promise<string>;
  sendMany: (calls: ContractCall[]) => Promise<string>;
  openDialog: () => void;
  pathname: string;
};

type Ask = (card: AskCard) => Promise<boolean>;

type DeskJobSnapshot =
  | { ok: false; status: "missing" }
  | {
      ok: true;
      jobId: string;
      name: string;
      status: string;
      result: unknown;
      error: string | null;
    };

type Queued = {
  ok: true;
  jobId: string;
  status: "waiting";
  message: string;
};

const ZERO = BigInt(0);

const ticketSchema = {
  type: "object",
  properties: {
    symbol: { type: "string", description: "Market symbol, such as SOL-PERP." },
    side: {
      type: "string",
      enum: ["bid", "ask"],
      description: "bid is long, ask is short.",
    },
    kind: {
      type: "string",
      enum: ["limit", "post_only", "immediate_or_cancel"],
    },
    price: {
      type: "string",
      description: "Limit price in dollars, such as 47.87.",
    },
    amount: {
      type: "string",
      description: "Order size in dollars of notional, such as 300.",
    },
  },
  required: ["symbol", "side", "price", "amount"],
} as const;

function asTicket(args: unknown): Ticket {
  const input = (args ?? {}) as Partial<Ticket>;
  const symbol = String(input.symbol ?? "").toUpperCase();
  if (!symbol) throw new Error("symbol is required.");
  if (input.side !== "bid" && input.side !== "ask")
    throw new Error("side must be bid or ask.");
  return {
    symbol,
    side: input.side,
    kind: (input.kind as OrderKind) || "limit",
    price: String(input.price ?? ""),
    amount: String(input.amount ?? ""),
  };
}

function giftLinkParts(raw?: string) {
  const source = raw?.trim() || window.location.href;
  let url: URL;
  try {
    url = new URL(source, window.location.origin);
  } catch {
    throw new Error("That is not a gift link.");
  }
  const match = /\/g\/(\d+)/.exec(url.pathname);
  const secret = url.hash.replace(/^#/, "").toLowerCase();
  if (!match || !/^[0-9a-f]{64}$/.test(secret)) {
    throw new Error(
      "Open the gift link on this Marks tab. The secret stays in the address bar, after the #.",
    );
  }
  return { giftId: Number(match[1]), secret };
}

function giftLabel(asset: GiftAsset) {
  if (asset.kind === "usdc") return money(asset.amount);
  if (asset.kind === "shares")
    return `${units(asset.units)} ${shareTicker(asset.asset_id)}`;
  return asset.symbol;
}

function needAccount(live: DeskLive) {
  if (!live.account) {
    live.openDialog();
    throw new Error(
      "This Marks tab has not published a NEAR account id yet. Ask them to refresh the Marks tab, then retry.",
    );
  }
  return live.account;
}

function dollarsAtoms(text: string, label: string) {
  const atoms = atomsFromDollars(text);
  if (!atoms || atoms <= ZERO) {
    throw new Error(`Enter ${label}, such as 25.`);
  }
  return atoms;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function deskActions(
  get: () => DeskLive,
  ask: Ask,
  goToMarket: (symbol: string) => void,
  toast: {
    info: (message: string) => void;
    success: (message: string, extra?: { href: string; label: string }) => void;
  },
) {
  const signed = (tx: string, done: string) => {
    const explorer = tx ? explorerTx(tx) : "";
    toast.success(
      done,
      tx ? { href: explorer, label: "View the transaction" } : undefined,
    );
    notifyTraded();
    return { ok: true as const, tx, explorer };
  };

  /** Wallet popups need a click on this page, so every signature waits on the card's button. */
  const confirm = async (card: AskCard, signing: () => void) => {
    const approved = await ask(card);
    if (!approved)
      throw new Error("The person declined this on the Marks tab.");
    signing();
  };

  const queue = (
    name: string,
    work: (signing: () => void) => Promise<unknown>,
  ): Queued => {
    const jobId = startDeskJob(name, work);
    toast.info("Your agent needs you on the Marks tab: press Open wallet.");
    return {
      ok: true,
      jobId,
      status: "waiting",
      message:
        "A card is up on the Marks tab. They press Open wallet there and sign. Call check-desk-job with this jobId now; it waits for the signature. Call again while it says waiting or signing.",
    };
  };

  /** Share buys need a print under an hour old; the refresh is its own signature. */
  const freshShare = async (
    wallet: DeskLive,
    id: string,
    signing: () => void,
  ) => {
    const share = await viewMarks<Share>(wallet.network, "get_share", {
      asset_id: id,
    });
    if (isFresh(share)) return share;
    await confirm(
      {
        title: `Refresh the ${id.toUpperCase()} price first`,
        rows: [
          { label: "Last print", value: money(share.price) },
          { label: "Oracle fee", value: "0.02 NEAR" },
        ],
        hint: "The print is over an hour old. Sign the refresh, then this card comes back for the trade.",
      },
      signing,
    );
    await refreshShare(wallet.send, id, wallet.network);
    const started = Date.now();
    while (Date.now() - started < 30_000) {
      const next = await viewMarks<Share>(wallet.network, "get_share", {
        asset_id: id,
      }).catch(() => null);
      if (next && next.updated_ns > share.updated_ns && isFresh(next)) {
        return next;
      }
      await sleep(1500);
    }
    throw new Error(
      `The ${id.toUpperCase()} price did not update. Try the refresh again.`,
    );
  };

  return [
    defineClientAction<{ symbol: string }, { ok: true; path: string }>({
      name: "open-market",
      description:
        "Move the person's Marks desk to a market page, such as SOL-PERP.",
      schema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Market symbol." },
        },
        required: ["symbol"],
      },
      run: ({ symbol }) => {
        const upper = String(symbol).toUpperCase();
        goToMarket(upper);
        return { ok: true, path: `/markets/${upper}` };
      },
    }),
    defineClientAction<unknown, { ok: true; ticket: Ticket }>({
      name: "fill-ticket",
      description:
        "Open the market and fill the person's order ticket without placing it, so they can review or edit it and press Place order themselves.",
      schema: ticketSchema,
      run: (args) => {
        const ticket = asTicket(args);
        goToMarket(ticket.symbol);
        fillTicket(ticket);
        return { ok: true, ticket };
      },
    }),
    defineClientAction<unknown, Queued>({
      name: "place-order",
      title: "Place an order on Marks",
      description:
        "Place a perp order through the same path as the Place order button. Returns jobId; the person presses Open wallet on the Marks tab and signs. Then poll check-desk-job.",
      schema: ticketSchema,
      run: async (args) => {
        const ticket = asTicket(args);
        const wallet = get();
        const account = needAccount(wallet);
        const market = await viewClient<Market>(wallet.network, "get_market", {
          symbol: ticket.symbol,
        });
        const ticks = ticksFromDollars(ticket.price, market.tick_size);
        const sized = ticks
          ? sizedOrder(ticket.amount, ticks, market.tick_size)
          : null;
        if (!ticks || !sized || sized.lots <= ZERO) {
          throw new Error(
            "That price and amount come to less than one contract.",
          );
        }
        goToMarket(ticket.symbol);
        fillTicket(ticket);
        const long = ticket.side === "bid";
        const card: AskCard = {
          title: `${long ? "Buy" : "Sell"} ${ticket.symbol}?`,
          rows: [
            { label: "Contracts", value: String(sized.lots) },
            { label: "Price", value: `$${ticket.price}` },
            { label: "Size", value: `$${ticket.amount}` },
            { label: "Order", value: ticket.kind.replaceAll("_", " ") },
          ],
        };
        return queue("place-order", async (signing) => {
          await confirm(card, signing);
          const { tx } = await placeOrder({
            account,
            network: wallet.network,
            intent: {
              symbol: ticket.symbol,
              side: ticket.side,
              kind: ticket.kind,
              ticks,
              lots: sized.lots,
            },
            send: wallet.send,
            sendMany: wallet.sendMany,
            onRefresh: () =>
              toast.info(
                "This price is over an hour old. Sign the refresh first.",
              ),
            afterRefresh: () =>
              confirm(
                {
                  ...card,
                  hint: "The price is fresh now. Sign the order.",
                },
                signing,
              ),
          });
          return signed(tx, "Order placed by your agent.");
        });
      },
    }),
    defineClientAction<
      {
        kind?: "usdc" | "shares" | "position";
        amount?: string;
        assetId?: string;
        symbol?: string;
        days?: 7 | 30 | 90;
        note?: string;
      },
      Queued
    >({
      name: "send-gift",
      title: "Send a Marks gift",
      description:
        'Create a claim link. For "$50 USDC" pass amount "50". For shares pass assetId like nvda plus amount in dollars. For a perp pass symbol like SOL-PERP. Returns jobId; poll check-desk-job for result.link.',
      schema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["usdc", "shares", "position"],
          },
          amount: {
            type: "string",
            description: 'Dollars, such as "50". Required for usdc and shares.',
          },
          assetId: {
            type: "string",
            description: "Share id for shares, such as nvda.",
          },
          symbol: {
            type: "string",
            description: "Market for a position gift, such as SOL-PERP.",
          },
          days: {
            type: "number",
            enum: [7, 30, 90],
            description: "How long the link stays open. Default 30.",
          },
          note: {
            type: "string",
            description: "Optional note sealed into the link.",
          },
        },
      },
      run: async (args) => {
        const wallet = get();
        const account = needAccount(wallet);
        const contract = contractFor(wallet.network);
        if (!contract) throw new Error("Marks contract is not configured.");
        const amount = args.amount
          ? String(args.amount).replace(/[$,\s]/g, "")
          : "";
        const assetId = args.assetId ? String(args.assetId).toLowerCase() : "";
        const symbol = args.symbol ? String(args.symbol).toUpperCase() : "";
        const kind: SendGiftInput["kind"] = assetId
          ? "shares"
          : symbol
            ? "position"
            : "usdc";
        const days = (
          [7, 30, 90].includes(Number(args.days)) ? Number(args.days) : 30
        ) as 7 | 30 | 90;
        const input: SendGiftInput = {
          kind,
          amount,
          assetId,
          symbol,
          days,
          note: String(args.note ?? ""),
        };
        await prepareGift({ account, network: wallet.network, input });
        const what =
          kind === "usdc"
            ? `$${amount} USDC`
            : kind === "shares"
              ? `$${amount} of ${assetId.toUpperCase()}`
              : `your ${symbol} position`;
        return queue("send-gift", async (signing) => {
          if (kind === "shares") await freshShare(wallet, assetId, signing);
          const plan = await prepareGift({
            account,
            network: wallet.network,
            input,
          });
          await confirm(
            {
              title: "Send this gift?",
              rows: [
                { label: "Gift", value: what },
                { label: "Fee", value: money(plan.fee) },
                ...(plan.buyShares
                  ? [
                      {
                        label: "Buys first",
                        value: money(plan.buyShares.amount),
                      },
                    ]
                  : []),
                { label: "Link open", value: `${days} days` },
              ],
              hint: "One signature locks the gift. The claim link comes back to chat.",
            },
            signing,
          );
          const result = await submitGift({
            account,
            network: wallet.network,
            contract,
            origin: window.location.origin,
            send: wallet.send,
            sendMany: wallet.sendMany,
            asset: plan.asset,
            days,
            note: input.note ?? "",
            buyShares: plan.buyShares,
          });
          const explorer = result.tx ? explorerTx(result.tx) : "";
          toast.success("Gift sent. The claim link is in chat.", {
            href: explorer,
            label: "View the transaction",
          });
          notifyTraded();
          return {
            ok: true,
            giftId: result.giftId,
            link: result.link,
            tx: result.tx,
            explorer,
          };
        });
      },
    }),
    defineClientAction<{ jobId?: string }, DeskJobSnapshot>({
      name: "check-desk-job",
      description:
        "Read a Marks desk job started by a write. waiting means the card is up on the Marks tab, signing means the wallet is open. Poll until done or error. Omit jobId to read the latest job.",
      schema: {
        type: "object",
        properties: {
          jobId: {
            type: "string",
            description: "Job id from the write.",
          },
        },
      },
      run: ({ jobId }) => {
        const job = deskJob(jobId ? String(jobId) : undefined);
        if (!job) {
          return { ok: false as const, status: "missing" as const };
        }
        return {
          ok: true as const,
          jobId: job.id,
          name: job.name,
          status: job.status,
          result: job.result ?? null,
          error: job.error ?? null,
        };
      },
    }),
    defineClientAction<{ giftId: number }, Queued>({
      name: "refund-gift",
      title: "Take a gift back",
      description:
        "Revoke an open gift the person sent. Same as Revoke on /send. The link stops working and the asset comes back. The 1% fee stays paid. Pass giftId from get-account.",
      schema: {
        type: "object",
        properties: {
          giftId: { type: "number", description: "Gift id from get-account." },
        },
        required: ["giftId"],
      },
      run: ({ giftId }) => {
        const wallet = get();
        needAccount(wallet);
        const id = Number(giftId);
        return queue("refund-gift", async (signing) => {
          await confirm(
            {
              title: "Take this gift back?",
              rows: [{ label: "Gift", value: `#${id}` }],
            },
            signing,
          );
          const tx = await cancelGift(wallet.send, id);
          return signed(tx, "Gift taken back.");
        });
      },
    }),
    defineClientAction<{ link?: string }, Queued>({
      name: "claim-gift",
      title: "Open a gift",
      description:
        "Claim an open gift into the signed-in account, same as Open on the gift link. Pass link only when they pasted the full URL. Otherwise the gift link must already be open on this Marks tab, secret in the address bar. Do not repeat the secret.",
      schema: {
        type: "object",
        properties: {
          link: {
            type: "string",
            description:
              "Full gift URL including the hash, only when they pasted it.",
          },
        },
      },
      run: ({ link }) => {
        const wallet = get();
        const account = needAccount(wallet);
        return queue("claim-gift", async (signing) => {
          const { giftId, secret } = giftLinkParts(link);
          const gift = await viewMarks<Gift | null>(
            wallet.network,
            "get_gift",
            { gift_id: giftId },
          );
          if (!gift) throw new Error(`Gift ${giftId} does not exist.`);
          if (publicKeyOf(secret) !== gift.claim_key)
            throw new Error("This link does not open that gift.");
          if (gift.status !== "open")
            throw new Error(`This gift is already ${gift.status}.`);
          if (gift.expiry_ns <= Date.now() * 1e6)
            throw new Error("This gift has expired.");
          await confirm(
            {
              title: "Open this gift?",
              rows: [
                { label: "Gift", value: giftLabel(gift.asset) },
                { label: "From", value: gift.sender },
                { label: "Into", value: account },
              ],
              hint: "Confirm and the gift opens into your account. The link stops working.",
            },
            signing,
          );
          const contract = contractFor(wallet.network);
          const signature = claimSignature(contract, secret, gift.id, account);
          const tx = await claimGift(wallet.send, gift.id, account, signature);
          const note = await openNote(secret, gift.note).catch(() => "");
          window.dispatchEvent(
            new CustomEvent("marks-gift-opened", {
              detail: { giftId: gift.id, note, hash: tx, recipient: account },
            }),
          );
          return signed(tx, "Gift opened.");
        });
      },
    }),
    defineClientAction<{ kind: "share" | "market"; id: string }, Queued>({
      name: "refresh-price",
      title: "Refresh an oracle price",
      description:
        "Ask the oracle for a new print. Costs 0.02 NEAR, which the person signs. kind share takes an asset id from list-shares, such as xau. kind market takes a perp symbol such as BNB-PERP. Call this when they ask to refresh a price.",
      schema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["share", "market"] },
          id: {
            type: "string",
            description:
              "Share id such as xau, or a market symbol such as BNB-PERP.",
          },
        },
        required: ["kind", "id"],
      },
      run: ({ kind, id }) => {
        const wallet = get();
        needAccount(wallet);
        if (kind === "market") {
          const symbol = String(id ?? "").toUpperCase();
          if (!symbol) throw new Error("Name the market, such as BNB-PERP.");
          return queue("refresh-price", async (signing) => {
            await confirm(
              {
                title: `Refresh ${symbol}?`,
                rows: [{ label: "Oracle fee", value: "0.02 NEAR" }],
              },
              signing,
            );
            const tx = await refreshMark(wallet.send, symbol, wallet.network);
            return signed(tx, `${symbol} price refreshed.`);
          });
        }
        const assetId = String(id ?? "").toLowerCase();
        if (!assetId) throw new Error("Name the share, such as xau.");
        return queue("refresh-price", async (signing) => {
          await confirm(
            {
              title: `Refresh ${assetId.toUpperCase()}?`,
              rows: [{ label: "Oracle fee", value: "0.02 NEAR" }],
            },
            signing,
          );
          const tx = await refreshShare(wallet.send, assetId, wallet.network);
          return signed(tx, `${assetId.toUpperCase()} price refreshed.`);
        });
      },
    }),
    defineClientAction<
      { side: "buy" | "sell"; assetId: string; amount: string },
      Queued
    >({
      name: "trade-shares",
      title: "Trade Marks shares",
      description:
        "Buy or sell shares at the oracle price, same as /stocks. Buy spends amount dollars of Marks balance. Sell amount is share units, such as 0.12.",
      schema: {
        type: "object",
        properties: {
          side: { type: "string", enum: ["buy", "sell"] },
          assetId: { type: "string", description: "Share id, such as nvda." },
          amount: {
            type: "string",
            description:
              "Dollars to spend when buying, share units when selling.",
          },
        },
        required: ["side", "assetId", "amount"],
      },
      run: async ({ side, assetId, amount }) => {
        const wallet = get();
        needAccount(wallet);
        const id = String(assetId ?? "").toLowerCase();
        if (!id) throw new Error("Name the share, such as nvda.");
        await viewMarks<Share>(wallet.network, "get_share", { asset_id: id });
        if (side === "buy") {
          const atoms = dollarsAtoms(
            String(amount).replace(/[$,\s]/g, ""),
            "how many dollars to spend",
          );
          return queue("trade-shares", async (signing) => {
            const share = await freshShare(wallet, id, signing);
            await confirm(
              {
                title: `Buy ${id.toUpperCase()}?`,
                rows: [
                  { label: "Spend", value: money(atoms) },
                  { label: "Price", value: money(share.price) },
                ],
              },
              signing,
            );
            const tx = await buyShares(wallet.send, id, atoms);
            return signed(tx, "Shares bought.");
          });
        }
        const count = unitsFromText(String(amount));
        if (!count || count <= ZERO) {
          throw new Error("Enter how many shares to sell, such as 0.12.");
        }
        return queue("trade-shares", async (signing) => {
          const share = await viewMarks<Share>(wallet.network, "get_share", {
            asset_id: id,
          });
          await confirm(
            {
              title: `Sell ${id.toUpperCase()}?`,
              rows: [
                { label: "Shares", value: String(amount) },
                { label: "Price", value: money(share.price) },
              ],
            },
            signing,
          );
          const tx = await sellShares(wallet.send, id, count);
          return signed(tx, "Shares sold.");
        });
      },
    }),
    defineClientAction<
      {
        collateral: "position" | "shares";
        action: "borrow" | "repay";
        symbol?: string;
        assetId?: string;
        amount: string;
        units?: string;
      },
      Queued
    >({
      name: "borrow-usdc",
      title: "Borrow or repay on Marks",
      description:
        "Borrow or repay USDC, same as /borrow. collateral position uses symbol (SOL-PERP). collateral shares uses assetId. amount is dollars. Borrowing against shares also needs units of shares to lock.",
      schema: {
        type: "object",
        properties: {
          collateral: { type: "string", enum: ["position", "shares"] },
          action: { type: "string", enum: ["borrow", "repay"] },
          symbol: { type: "string" },
          assetId: { type: "string" },
          amount: { type: "string", description: "USDC dollars, such as 50." },
          units: {
            type: "string",
            description: "Share units to lock when borrowing against shares.",
          },
        },
        required: ["collateral", "action", "amount"],
      },
      run: (args) => {
        const wallet = get();
        needAccount(wallet);
        const atoms = dollarsAtoms(String(args.amount), "the USDC amount");
        const verb = args.action === "repay" ? "Repay" : "Borrow";
        if (args.collateral === "position") {
          const symbol = String(args.symbol ?? "").toUpperCase();
          if (!symbol) throw new Error("Name the market, such as SOL-PERP.");
          return queue("borrow-usdc", async (signing) => {
            await confirm(
              {
                title: `${verb} against ${symbol}?`,
                rows: [
                  { label: "Amount", value: money(atoms) },
                  {
                    label: "Fee",
                    value: args.action === "borrow" ? "1%" : "none",
                  },
                ],
              },
              signing,
            );
            const tx = await borrowOnPosition(
              wallet.send,
              args.action === "repay" ? "repay" : "borrow",
              symbol,
              atoms,
            );
            return signed(
              tx,
              args.action === "repay" ? "Loan repaid." : "Borrowed.",
            );
          });
        }
        const assetId = String(args.assetId ?? "").toLowerCase();
        if (!assetId) throw new Error("Name the share, such as nvda.");
        if (args.action === "repay") {
          return queue("borrow-usdc", async (signing) => {
            await confirm(
              {
                title: `Repay ${assetId.toUpperCase()} loan?`,
                rows: [{ label: "Amount", value: money(atoms) }],
              },
              signing,
            );
            const tx = await repayShareLoan(wallet.send, assetId, atoms);
            return signed(tx, "Share loan repaid.");
          });
        }
        const lock = unitsFromText(String(args.units ?? ""));
        if (!lock || lock <= ZERO) {
          throw new Error("Say how many shares to lock, such as 0.12.");
        }
        return queue("borrow-usdc", async (signing) => {
          await confirm(
            {
              title: `Borrow against ${assetId.toUpperCase()}?`,
              rows: [
                { label: "Lock", value: `${args.units} shares` },
                { label: "Borrow", value: money(atoms) },
                { label: "Fee", value: "1%" },
              ],
            },
            signing,
          );
          const tx = await borrowAgainstShares(
            wallet.send,
            assetId,
            lock,
            atoms,
          );
          return signed(tx, "Borrowed against shares.");
        });
      },
    }),
    defineClientAction<
      {
        amount: string;
        source: string;
        merchant?: string;
        paymentId?: string;
        label?: string;
        borrowed?: string;
      },
      Queued
    >({
      name: "pay-bill",
      title: "Pay a Marks bill",
      description:
        "Pay a testnet mUSDC checkout. amount is dollars. merchant is who receives it. source is balance, perp:SOL-PERP, or share:aapl. The contract borrows only the shortfall against that source and pays the merchant in one signature.",
      schema: {
        type: "object",
        properties: {
          amount: { type: "string", description: "USDC dollars, such as 40." },
          source: { type: "string" },
          merchant: {
            type: "string",
            description: "NEAR account that receives the payment.",
          },
          paymentId: {
            type: "string",
            description:
              "Payment link id. After the signature, that link is marked paid.",
          },
          label: { type: "string" },
          borrowed: { type: "string" },
        },
        required: ["amount", "source", "merchant"],
      },
      run: (args) => {
        const wallet = get();
        const account = needAccount(wallet);
        const atoms = dollarsAtoms(String(args.amount), "the bill");
        const source = String(args.source);
        const merchant = String(args.merchant ?? "")
          .trim()
          .toLowerCase();
        if (!merchant) throw new Error("Name the account that gets paid.");
        return queue("pay-bill", async (signing) => {
          await confirm(
            {
              title: args.label ? `Pay ${args.label}?` : "Pay this bill?",
              rows: [
                { label: "Bill", value: money(atoms) },
                { label: "From", value: source },
                {
                  label: "Borrows",
                  value: (() => {
                    const borrowed = atomsFromDollars(
                      String(args.borrowed ?? "0"),
                    );
                    return borrowed && borrowed > ZERO
                      ? money(borrowed)
                      : "Nothing";
                  })(),
                },
                { label: "To", value: merchant },
              ],
            },
            signing,
          );
          const tx = await payBill(wallet.send, merchant, atoms, source);
          const paymentId = String(args.paymentId ?? "");
          if (paymentId) {
            void fetch("/api/checkout/paid", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                id: paymentId,
                hash: tx,
                account,
              }),
            }).catch(() => undefined);
          }
          return signed(tx, "Bill paid.");
        });
      },
    }),
    defineClientAction<{ symbol: string; orderId: number }, Queued>({
      name: "cancel-order",
      title: "Cancel a resting order",
      description:
        "Cancel a resting perp order. Pass symbol and orderId from get-account.",
      schema: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          orderId: { type: "number" },
        },
        required: ["symbol", "orderId"],
      },
      run: ({ symbol, orderId }) => {
        const wallet = get();
        needAccount(wallet);
        const market = String(symbol).toUpperCase();
        const id = Number(orderId);
        return queue("cancel-order", async (signing) => {
          await confirm(
            {
              title: "Cancel this order?",
              rows: [
                { label: "Market", value: market },
                { label: "Order", value: String(id) },
              ],
            },
            signing,
          );
          const tx = await cancelOrder(wallet.send, market, id);
          return signed(tx, "Order cancelled.");
        });
      },
    }),
    defineClientAction<{ symbol: string; amount: string }, Queued>({
      name: "commit-margin",
      title: "Commit margin to a market",
      description:
        "Move Marks balance into one market's margin, same as Commit on the market page.",
      schema: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          amount: { type: "string", description: "Dollars, such as 100." },
        },
        required: ["symbol", "amount"],
      },
      run: ({ symbol, amount }) => {
        const wallet = get();
        needAccount(wallet);
        const market = String(symbol).toUpperCase();
        const atoms = dollarsAtoms(String(amount), "the USDC to commit");
        return queue("commit-margin", async (signing) => {
          await confirm(
            {
              title: `Commit to ${market}?`,
              rows: [{ label: "Amount", value: money(atoms) }],
            },
            signing,
          );
          const tx = await commitMargin(wallet.send, market, atoms);
          return signed(tx, "Committed.");
        });
      },
    }),
    defineClientAction<
      { action: "claim" | "deposit" | "withdraw"; amount?: string },
      Queued
    >({
      name: "move-usdc",
      title: "Faucet, deposit or withdraw",
      description:
        "Same as /faucet. action claim mints 1,000 mUSDC once a day. deposit moves wallet mUSDC into the Marks balance. withdraw sends Marks balance back to the wallet. deposit and withdraw need amount in dollars.",
      schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["claim", "deposit", "withdraw"] },
          amount: {
            type: "string",
            description: "Dollars for deposit or withdraw.",
          },
        },
        required: ["action"],
      },
      run: ({ action, amount }) => {
        const wallet = get();
        const account = needAccount(wallet);
        const token = tokenFor(wallet.network);
        const contract = contractFor(wallet.network);
        if (action === "claim") {
          return queue("move-usdc", async (signing) => {
            const relayed = await claimFaucetByRelay(account);
            if (relayed) return signed(relayed, "Faucet claimed.");
            await confirm(
              {
                title: "Claim 1,000 mUSDC?",
                rows: [{ label: "Once a day", value: "Yes" }],
              },
              signing,
            );
            const tx = await claimFaucetSelf(wallet.send, token);
            return signed(tx, "Faucet claimed.");
          });
        }
        const atoms = dollarsAtoms(String(amount ?? ""), "the amount");
        if (action === "deposit") {
          return queue("move-usdc", async (signing) => {
            await confirm(
              {
                title: "Deposit into Marks?",
                rows: [{ label: "Amount", value: money(atoms) }],
              },
              signing,
            );
            const tx = await depositToMarks(
              wallet.send,
              token,
              contract,
              atoms,
            );
            return signed(tx, "Deposited into Marks.");
          });
        }
        return queue("move-usdc", async (signing) => {
          await confirm(
            {
              title: "Withdraw to your wallet?",
              rows: [{ label: "Amount", value: money(atoms) }],
            },
            signing,
          );
          const tx = await withdrawFromMarks(wallet.send, atoms);
          return signed(tx, "Withdrawn to your wallet.");
        });
      },
    }),
    defineClientAction<
      {
        seriesId: string;
        side: "bid" | "ask";
        premium: string;
        lots: number;
      },
      Queued
    >({
      name: "place-option",
      title: "Place a capped call",
      description:
        "Place a capped call, same as /stocks. seriesId from list-shares. side bid buys the call, ask writes it. premium is dollars per contract. lots is how many contracts.",
      schema: {
        type: "object",
        properties: {
          seriesId: { type: "string" },
          side: {
            type: "string",
            enum: ["bid", "ask"],
            description: "bid buys the call, ask writes it.",
          },
          premium: {
            type: "string",
            description: "Premium in dollars per contract.",
          },
          lots: { type: "number", description: "Contract count." },
        },
        required: ["seriesId", "side", "premium", "lots"],
      },
      run: ({ seriesId, side, premium, lots }) => {
        const wallet = get();
        needAccount(wallet);
        const atoms = dollarsAtoms(String(premium), "the premium");
        const count = Number(lots);
        if (!Number.isInteger(count) || count <= 0) {
          throw new Error("Enter how many contracts, such as 1.");
        }
        return queue("place-option", async (signing) => {
          await confirm(
            {
              title: `${side === "bid" ? "Buy" : "Write"} this call?`,
              rows: [
                { label: "Series", value: String(seriesId) },
                { label: "Premium", value: money(atoms) },
                { label: "Contracts", value: String(count) },
              ],
            },
            signing,
          );
          const tx = await placeOption(wallet.send, {
            seriesId: String(seriesId),
            side,
            premium: atoms,
            lots: count,
          });
          return signed(tx, "Option placed.");
        });
      },
    }),
    defineClientAction<{ seriesId: string }, Queued>({
      name: "settle-option",
      title: "Claim option settlement",
      description: "Claim settlement on an expired series, same as /stocks.",
      schema: {
        type: "object",
        properties: { seriesId: { type: "string" } },
        required: ["seriesId"],
      },
      run: ({ seriesId }) => {
        const wallet = get();
        needAccount(wallet);
        const id = String(seriesId);
        return queue("settle-option", async (signing) => {
          const series = await viewMarks<Series>(wallet.network, "get_series", {
            series_id: id,
          });
          if (!series.settle_price) {
            if (
              BigInt(series.expiry_ns) >
              BigInt(Date.now()) * BigInt(1_000_000)
            ) {
              throw new Error("This series has not expired yet.");
            }
            await confirm(
              {
                title: "Settle this series first?",
                rows: [{ label: "Series", value: id }],
                hint: "Settling reads the first print after expiry. Then this card comes back for the claim.",
              },
              signing,
            );
            await settleSeries(wallet.send, id);
            const started = Date.now();
            let settled = false;
            while (!settled && Date.now() - started < 30_000) {
              await sleep(1500);
              const next = await viewMarks<Series>(
                wallet.network,
                "get_series",
                {
                  series_id: id,
                },
              ).catch(() => null);
              settled = Boolean(next?.settle_price);
            }
            if (!settled)
              throw new Error("The series did not settle yet. Try again.");
          }
          await confirm(
            {
              title: "Claim this settlement?",
              rows: [{ label: "Series", value: id }],
            },
            signing,
          );
          const tx = await claimSettlement(wallet.send, id);
          return signed(tx, "Settlement claimed.");
        });
      },
    }),
  ];
}
