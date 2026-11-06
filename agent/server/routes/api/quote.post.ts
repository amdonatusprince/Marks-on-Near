import { defineEventHandler } from "h3";
import { quoteBody } from "../../../app/marks/lib/quote-request";

async function post(request: Request) {
  const incoming = (await request.json().catch(() => ({}))) as {
    dry?: boolean;
    recipient?: string;
  };
  const dry = incoming.dry !== false;
  const recipient =
    // guard:allow-env-credential — public deployment recipient, not a user's credential
    incoming.recipient || process.env.VITE_INTENTS_RECIPIENT || "marks.near";
  const response = await fetch("https://1click.chaindefuser.com/v0/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(quoteBody(recipient, dry)),
  });
  const body = await response.json();
  return Response.json(body, { status: response.status });
}

export default defineEventHandler((event) => post(event.req));
