import { quoteBody } from "@/lib/quote-request";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const incoming = (await request.json().catch(() => ({}))) as {
    dry?: boolean;
    recipient?: string;
  };
  const dry = incoming.dry !== false;
  const recipient = incoming.recipient || process.env.NEXT_PUBLIC_INTENTS_RECIPIENT || "marks.near";
  const response = await fetch("https://1click.chaindefuser.com/v0/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(quoteBody(recipient, dry)),
  });
  const body = await response.json();
  return NextResponse.json(body, { status: response.status });
}
