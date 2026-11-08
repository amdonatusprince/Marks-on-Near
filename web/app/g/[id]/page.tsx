import { ClaimFlow } from "@/components/claim-flow";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "A gift for you",
  description:
    "Someone sent you a gift on Marks. Open it with Google: no wallet, no seed phrase, no gas.",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClaimFlow giftId={/^\d{1,15}$/.test(id) ? Number(id) : null} />;
}
