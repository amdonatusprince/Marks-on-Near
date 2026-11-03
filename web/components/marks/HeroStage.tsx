"use client";

// From Moi (MIT): https://github.com/ramakrishnanhulk20/Moi.
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import dynamic from "next/dynamic";
import {
  Component,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Certificate, type CertificateProps } from "./Certificate";
import { EnvelopeFallback } from "./EnvelopeFallback";
import type { HeroLayout } from "./EnvelopeScene";
import { useMediaQuery } from "./useMediaQuery";

// The 3D code is a separate download, started only after the first paint, so the hero copy never waits on it.
const EnvelopeScene = dynamic(
  () => import("./EnvelopeScene").then((module) => module.EnvelopeScene),
  { ssr: false },
);

// The claim page's scene fills its own box: the envelope rests in the middle and the certificate lands
// in the middle at 0.92 of the box width.
const CLAIM_LAYOUT: HeroLayout = {
  restX: 0.5,
  restY: 0.5,
  finalX: 0.5,
  finalY: 0.5,
  finalW: 0.92,
  envScale: 1,
};

/** A browser with no WebGL makes the canvas throw. This keeps that from taking the page down with it. */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

// The numbers behind the poses live in lab.css as custom properties on the hero section, so the
// closed-envelope fallback and the reduced-motion composite use the very same positions.
function readLayout(section: HTMLElement, layout: HeroLayout): void {
  const style = getComputedStyle(section);
  const read = (name: string, fallback: number) => {
    const value = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  layout.restX = read("--rest-x", layout.restX);
  layout.restY = read("--rest-y", layout.restY);
  layout.finalX = read("--final-x", layout.finalX);
  layout.finalY = read("--final-y", layout.finalY);
  layout.finalW = read("--final-w", layout.finalW);
  layout.envScale = read("--env-scale", layout.envScale);
}

/**
 * Everything behind the copy: the stage light, the 3D envelope and certificate, and the closed
 * envelope drawing that stands in until the first frame. It also owns the scroll: it pins the hero,
 * publishes the progress as --p on the hero section (CSS reads it, React never re-renders per
 * frame) and hands the same number to the scene. Reduced motion gets a still composite instead:
 * no canvas, no pin, the certificate already in its final pose.
 */
export function HeroStage({
  layout = "hero",
  progress: driven,
  certificate: single,
  certificates,
  slideIndex,
}: {
  layout?: "hero" | "claim";
  progress?: { value: number };
  certificate?: CertificateProps;
  certificates?: CertificateProps[];
  /** Which certificate to show. The hero owns this so the card and the headline change together. */
  slideIndex?: number;
} = {}) {
  const claim = layout === "claim";
  const certificate = useMemo(
    () => (certificates ? { slides: certificates } : single),
    [certificates, single],
  );
  const compact = useMediaQuery("(max-width: 1023px)");
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const stage = useRef<HTMLDivElement>(null);
  const cardLayer = useRef<HTMLDivElement>(null);
  const [ownProgress] = useState(() => ({ value: 0 }));
  // In the claim layout the claim page drives the scene by time and hands its own progress in.
  const progress = driven ?? ownProgress;
  const [sceneLayout] = useState<HeroLayout>(() =>
    claim
      ? { ...CLAIM_LAYOUT }
      : { restX: 0.74, restY: 0.5, finalX: 0.68, finalY: 0.58, finalW: 0.54, envScale: 1 },
  );
  const [sceneMounted, setSceneMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [inView, setInView] = useState(true);

  useEffect(() => {
    if (claim) return;
    const element = stage.current;
    const section = element?.closest("section");
    if (!element || !section) return;
    const apply = () => {
      readLayout(section, sceneLayout);
      // The spotlight sits on the certificate's final centre. Phones centre it in the box.
      section.style.setProperty(
        "--cx",
        compact ? "50%" : `${(sceneLayout.finalX * 100).toFixed(2)}%`,
      );
      section.style.setProperty(
        "--cy",
        compact ? "50%" : `${(sceneLayout.finalY * 100).toFixed(2)}%`,
      );
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    window.addEventListener("resize", apply);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [claim, compact, sceneLayout]);

  useEffect(() => {
    if (reduced) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSceneMounted(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [reduced]);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry?.isIntersecting ?? true),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // useLayoutEffect, not useEffect: the pin wraps the hero in a spacer and moves it out of the node
  // React will remove. This cleanup runs first and puts the node back. A passive cleanup runs after
  // that removal and the browser throws "the node to be removed is not a child of this node".
  useLayoutEffect(() => {
    if (reduced || claim) return;
    const element = stage.current;
    const section = element?.closest("section");
    if (!element || !section) return;
    gsap.registerPlugin(ScrollTrigger);
    const context = gsap.context(() => {
      gsap.to(progress, {
        value: 1,
        ease: "none",
        onUpdate: () => section.style.setProperty("--p", progress.value.toFixed(4)),
        scrollTrigger: compact
          ? {
              // On phones and tablets only the scene box is pinned, once it sits mid-screen.
              trigger: element,
              start: "center center",
              end: () => `+=${Math.round(window.innerHeight * 0.8)}`,
              pin: true,
              // The hero is a flex column, and ScrollTrigger skips the spacing under a flex parent unless it is asked outright.
              pinSpacing: true,
              scrub: 0.6,
              anticipatePin: 1,
              invalidateOnRefresh: true,
            }
          : {
              trigger: section,
              // The sticky nav is 72px tall from 768px, so the pin starts under it.
              start: "top 72px",
              end: () => `+=${Math.round(window.innerHeight * 1.1)}`,
              pin: true,
              // The page column is a flex parent, so the spacing under the pin has to be asked for outright.
              pinSpacing: true,
              scrub: 0.6,
              anticipatePin: 1,
              invalidateOnRefresh: true,
            },
      });
    }, section);
    let alive = true;
    // Fonts change the height of the copy, which moves the pin points.
    void document.fonts.ready.then(() => {
      if (alive) ScrollTrigger.refresh();
    });
    return () => {
      alive = false;
      context.revert();
      section.style.removeProperty("--p");
      progress.value = 0;
    };
  }, [reduced, claim, compact, progress]);

  return (
    <div className="hero-stage" ref={stage}>
      {claim ? null : (
        <>
          <div className="hero-light hero-light-a" aria-hidden="true" />
          <div className="hero-light hero-light-b" aria-hidden="true" />
        </>
      )}
      {reduced && !claim ? (
        <div className="hero-static">
          <div className="hero-static-envelope" aria-hidden="true">
            <EnvelopeFallback open />
          </div>
          <div className="hero-static-cert">
            <Certificate {...certificate} slideIndex={slideIndex} />
          </div>
        </div>
      ) : (
        <>
          <div className="hero-stage-canvas" aria-hidden="true">
            {sceneMounted ? (
              <SceneBoundary>
                <EnvelopeScene
                  progress={progress}
                  layout={sceneLayout}
                  compact={compact}
                  mode={layout}
                  certificate={certificate}
                  slideIndex={slideIndex}
                  active={inView}
                  layer={cardLayer}
                  onFirstFrame={() => setReady(true)}
                />
              </SceneBoundary>
            ) : null}
            <div className="hero-card-layer" ref={cardLayer} />
          </div>
          <div className="hero-fallback" data-gone={ready ? "true" : "false"}>
            <EnvelopeFallback open={false} />
          </div>
        </>
      )}
    </div>
  );
}
