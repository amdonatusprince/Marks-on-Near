import Link from "next/link";
import { MarketBoard } from "@/components/market-board";
import type { CertificateProps } from "@/components/marks/Certificate";
import { Hero, type TickerEntry } from "@/components/marks/Hero";
import "@/components/marks/sections.css";
import { grouped, price } from "@/lib/format";
import { contractFor } from "@/lib/network";
import { selectedNetwork } from "@/lib/network-server";
import { view, type Market } from "@/lib/rpc";
import type { Share } from "@/lib/v2";

export const dynamic = "force-dynamic";

const GIFT_ATOMS = BigInt(25_000_000);

const STEPS = [
  {
    label: "Faucet",
    heading: "Claim test USDC",
    body: "1,000 mock USDC a day, free. Google sign-in, no gas.",
    math: (
      <>
        <b>1,000 mUSDC</b> per account per day
      </>
    ),
  },
  {
    label: "Trade",
    heading: "Perps, shares, calls",
    body: "12 markets at up to 10x. Calls risk only the premium.",
    math: (
      <>
        call payout <b>min(max(S − K, 0), C − K)</b>
      </>
    ),
  },
  {
    label: "Borrow",
    heading: "Spend without selling",
    body: "Borrow USDC against a position or your shares.",
    math: (
      <>
        limit <b>collateral + ½ profit − debt − margin</b>, fee <b>1%</b>
      </>
    ),
  },
  {
    label: "Gift",
    heading: "Send it as a link",
    body: "USDC, a share or a whole position. Your friend claims with Google.",
    math: (
      <>
        fee <b>1%</b>, refundable after <b>1 to 90 days</b>
      </>
    ),
  },
] as const;

export default async function Home() {
  const network = await selectedNetwork();
  const configured = Boolean(contractFor(network));
  const [markets, shares] = configured
    ? await Promise.all([
        view<Market[]>(network, "get_markets", {}).catch(() => [] as Market[]),
        view<Share[]>(network, "get_shares", {}).catch(() => [] as Share[]),
      ])
    : [[] as Market[], [] as Share[]];

  const ticker: TickerEntry[] = markets
    .filter((market) => market.mark_ticks > 0)
    .map((market) => ({
      name: market.symbol.replace("-PERP", ""),
      price: price(market.mark_ticks, market.tick_size),
    }));
  const nvda = shares.find((share) => share.asset_id === "nvda" && BigInt(share.price) > BigInt(0));
  const btc = markets.find((market) => market.symbol === "BTC-PERP" && market.mark_ticks > 0);
  const gift: CertificateProps = nvda
    ? {
        figure: grouped(
          (Number((GIFT_ATOMS * BigInt(1_000_000)) / BigInt(nvda.price)) / 1_000_000).toFixed(4),
        ),
        holding: "SHARES OF NVIDIA CORPORATION",
        worth: "WORTH $25.00 TODAY",
      }
    : {
        verb: "GIFTED",
        figure: "A LINK",
        holding: "A POSITION OR A STOCK",
        worth: "CLAIMED WITH GOOGLE",
        note: ["FEE", "1 PERCENT"],
      };
  const certificates: CertificateProps[] = [
    {
      verb: "IS LONG",
      figure: "10×",
      holding: "BTC-PERP, SETTLED IN USDC",
      worth: btc ? `MARK ${price(btc.mark_ticks, btc.tick_size)} A CONTRACT` : null,
      note: ["OPENED", "IN ONE CLICK"],
    },
    {
      verb: "BORROWED",
      figure: "$500",
      holding: "USDC AGAINST AN OPEN POSITION",
      worth: "WITHOUT SELLING IT",
      note: ["FEE", "1 PERCENT"],
    },
    gift,
  ];

  return (
    <>
      <Hero ticker={ticker} certificates={certificates} />

      <section className="sec" id="how" aria-labelledby="how-title">
        <p className="sec-label">How it works</p>
        <h2 className="sec-title" id="how-title">
          One balance, <span className="sec-title-italic">four moves.</span>
        </h2>
        <p className="sec-lede">One USDC balance on NEAR. Every fee is 1 percent.</p>
        <ol className="how-strip">
          {STEPS.map((step, index) => (
            <li className="how-frame" key={step.label}>
              <p className="how-number">{String(index + 1).padStart(2, "0")}</p>
              <p className="sec-label how-label">{step.label}</p>
              <h3 className="how-heading">{step.heading}</h3>
              <p className="how-body">{step.body}</p>
              <p className="how-math">{step.math}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="sec" aria-labelledby="board-title">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="sec-label">The desk</p>
            <h2 className="sec-title" id="board-title">
              Every book, <span className="sec-title-italic">live.</span>
            </h2>
          </div>
          <Link className="btn-line" href="/stocks">
            Shares and calls
          </Link>
        </div>
        <div className="market-board-reveal mt-10">
          {markets.length > 0 ? (
            <MarketBoard network={network} markets={markets} />
          ) : (
            <p className="text-ink-muted">The board could not be read right now.</p>
          )}
        </div>
      </section>
    </>
  );
}
