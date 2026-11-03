'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

const initializationIdleTimeoutMs = 800;

export function HeroRouteController({
  children,
  style,
}: {
  children: ReactNode;
  style: CSSProperties;
}): ReactNode {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [inView, setInView] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const image = viewport
      .closest('.home-hero')
      ?.querySelector<HTMLImageElement>('.hero-background-image img');
    let disposed = false;
    let initializationScheduled = false;
    let idleId: number | null = null;
    let fallbackId: number | null = null;
    let frameId: number | null = null;

    function giveImagePaintOpportunity(): void {
      idleId = null;
      fallbackId = null;
      if (disposed) return;
      // Yield through a complete frame before revealing the decorative journey.
      frameId = window.requestAnimationFrame(() => {
        if (disposed) return;
        frameId = window.requestAnimationFrame(() => {
          frameId = null;
          if (!disposed) setReady(true);
        });
      });
    }

    function scheduleInitialization(): void {
      if (disposed || initializationScheduled) return;
      initializationScheduled = true;
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(giveImagePaintOpportunity, {
          timeout: initializationIdleTimeoutMs,
        });
      } else {
        // Without requestIdleCallback, yield to the task queue and then paint.
        fallbackId = window.setTimeout(giveImagePaintOpportunity, 0);
      }
    }

    function syncMotion(): void {
      setReduced(reduceMotion.matches);
    }

    function syncVisibility(): void {
      setDocumentVisible(!document.hidden);
    }

    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        setInView(entry?.isIntersecting ?? false);
      },
      { threshold: 0.1 },
    );

    syncMotion();
    syncVisibility();
    visibilityObserver.observe(viewport);
    reduceMotion.addEventListener('change', syncMotion);
    document.addEventListener('visibilitychange', syncVisibility);

    if (image && !image.complete) {
      image.addEventListener('load', scheduleInitialization, { once: true });
      image.addEventListener('error', scheduleInitialization, { once: true });
    } else {
      scheduleInitialization();
    }

    return () => {
      disposed = true;
      visibilityObserver.disconnect();
      reduceMotion.removeEventListener('change', syncMotion);
      document.removeEventListener('visibilitychange', syncVisibility);
      image?.removeEventListener('load', scheduleInitialization);
      image?.removeEventListener('error', scheduleInitialization);
      if (idleId !== null) window.cancelIdleCallback(idleId);
      if (fallbackId !== null) window.clearTimeout(fallbackId);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, []);

  const motion = reduced
    ? 'static'
    : complete
      ? 'complete'
      : ready && inView && documentVisible
        ? 'playing'
        : 'paused';

  return (
    <div
      aria-hidden="true"
      className="hero-route-animation"
      data-motion={motion}
      data-ready={ready}
      onAnimationEnd={(event) => {
        if (
          event.animationName === 'hero-art-route-travel' &&
          event.target instanceof Element &&
          event.target.getAttribute('data-route-primary') === 'true'
        ) {
          setComplete(true);
        }
      }}
      ref={viewportRef}
      style={style}
    >
      {children}
    </div>
  );
}
