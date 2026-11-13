import type { OrderKind, Side } from "@/marks/lib/order-plan";

export const TICKET_FILL = "marks-fill-ticket";

export type TicketFill = {
  symbol: string;
  side: Side;
  kind?: OrderKind;
  price?: string;
  amount?: string;
};

let pending: TicketFill | null = null;

/** Fills the ticket now, or when the market page mounts after a navigation. */
export function fillTicket(fill: TicketFill) {
  pending = fill;
  window.dispatchEvent(new CustomEvent(TICKET_FILL, { detail: fill }));
}

export function takePendingFill(symbol: string) {
  if (pending?.symbol !== symbol) return null;
  const fill = pending;
  pending = null;
  return fill;
}
