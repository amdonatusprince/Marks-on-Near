import { useParams } from "react-router";

import { ClaimFlow } from "@/marks/components/claim-flow";
import { marksMeta } from "@/marks/lib/site-meta";

export const meta = () => [
  ...marksMeta(
    "Marks - A gift for you",
    "Someone sent you a gift on Marks. Open it with Google: no wallet, no seed phrase, no gas.",
  ),
  { name: "robots", content: "noindex, nofollow" },
  { name: "referrer", content: "no-referrer" },
];

export default function ClaimPage() {
  const { id = "" } = useParams();
  return <ClaimFlow giftId={/^\d{1,15}$/.test(id) ? Number(id) : null} />;
}
