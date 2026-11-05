// From Moi (MIT): https://github.com/ramakrishnanhulk20/Moi. Copy and data changed for Marks.
import { motion, useReducedMotion } from "framer-motion";
import { displayItalic } from "@/marks/lib/fonts";
import Link from "@/marks/components/link";
import { useEffect, useState } from "react";
import type { CertificateProps } from "./Certificate";
import { Grain } from "./Grain";
import { HeroStage } from "./HeroStage";
import { SmoothScroll } from "./SmoothScroll";
import "./hero.css";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

type Word = { text: string; italic?: boolean };

const SLIDE_MS = 3000;

const SLIDES: readonly {
  id: string;
  lines: readonly (readonly Word[])[];
  description: string;
}[] = [
  {
    id: "trade",
    lines: [
      [{ text: "Trade" }, { text: "perps" }],
      [
        { text: "and", italic: true },
        { text: "stocks.", italic: true },
      ],
    ],
    description:
      "Long or short crypto, gold, oil and US shares. One USDC balance, up to 10x.",
  },
  {
    id: "borrow",
    lines: [
      [{ text: "Borrow" }, { text: "against" }],
      [
        { text: "your", italic: true },
        { text: "positions.", italic: true },
      ],
    ],
    description:
      "Draw USDC against an open trade or your shares, and keep the position. The fee is 1%.",
  },
  {
    id: "gift",
    lines: [
      [{ text: "Gift" }, { text: "your" }],
      [
        { text: "friends", italic: true },
        { text: "assets.", italic: true },
      ],
    ],
    description:
      "Gift anyone a perp, an open position, or a stock. They claim it from the link, with no wallet. The fee is 1%.",
  },
];

export type TickerEntry = { name: string; price: string };

function riseTransition(reduced: boolean, delay: number) {
  return reduced
    ? { opacity: { duration: 0.3 }, y: { duration: 0 } }
    : { duration: 0.9, delay, ease: EASE_OUT };
}

export function Hero({
  ticker,
  certificates,
}: {
  ticker: TickerEntry[];
  certificates?: CertificateProps[] | undefined;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setIndex((current) => (current + 1) % SLIDES.length);
    }, SLIDE_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <>
      <SmoothScroll />
      <section className="hero" aria-label="Marks">
        <HeroCopy index={index} />
        <LiveTicker entries={ticker} />
        <HeroStage certificates={certificates} slideIndex={index} />
        <Grain />
      </section>
    </>
  );
}

function HeroCopy({ index }: { index: number }) {
  const reduced = Boolean(useReducedMotion());

  return (
    <div className="hero-content">
      <div className="hero-inner">
        <div className="hero-slides" aria-live="off">
          {SLIDES.map((item, itemIndex) => {
            const active = itemIndex === index;
            const Heading = active ? "h1" : "p";
            return (
              <div
                className="hero-slide"
                key={item.id}
                data-active={active ? "true" : "false"}
                aria-hidden={active ? undefined : true}
              >
                <Heading className="hero-title">
                  {item.lines.map((line, lineIndex) => (
                    <span className="hero-title-line" key={lineIndex}>
                      {line.map((word, position) => (
                        <span key={word.text}>
                          {position > 0 ? " " : null}
                          <span
                            className={
                              word.italic
                                ? "hero-word hero-word-italic"
                                : "hero-word"
                            }
                            style={
                              word.italic
                                ? { fontFamily: displayItalic.style.fontFamily }
                                : undefined
                            }
                          >
                            {word.text}
                          </span>
                        </span>
                      ))}
                    </span>
                  ))}
                </Heading>
                <p className="hero-sub">{item.description}</p>
              </div>
            );
          })}
        </div>

        <motion.div
          className="hero-actions"
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={riseTransition(reduced, 0.6)}
        >
          <Link className="hero-btn hero-btn-primary" href="/markets">
            Start trading
          </Link>
          <Link className="hero-btn hero-btn-secondary" href="/send">
            Send a gift
          </Link>
        </motion.div>
      </div>
    </div>
  );
}

const COPIES = [0, 1, 2, 3];

/** The price strip along the bottom of the hero. With no prices it renders nothing. */
function LiveTicker({ entries }: { entries: TickerEntry[] }) {
  const reduced = Boolean(useReducedMotion());
  if (entries.length === 0) return null;
  return (
    <motion.div
      className="hero-ticker"
      role="region"
      aria-label="Live prices"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduced
          ? { opacity: { duration: 0.3 }, y: { duration: 0 } }
          : { duration: 0.8, delay: 0.8, ease: EASE_OUT }
      }
    >
      <div className="hero-ticker-track">
        {COPIES.map((copy) =>
          entries.map((entry) => (
            <span
              className="hero-ticker-item"
              key={`${copy}-${entry.name}`}
              aria-hidden={copy > 0 ? "true" : undefined}
            >
              {`${entry.name}  ${entry.price}`}
              <span className="hero-ticker-dot">·</span>
            </span>
          )),
        )}
      </div>
    </motion.div>
  );
}
