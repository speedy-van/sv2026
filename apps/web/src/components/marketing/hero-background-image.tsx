import Image from 'next/image';
import type { ReactNode } from 'react';

const artwork = {
  desktop: {
    avif: '/images/speedy-van-highlands-luton-hero.avif',
    webp: '/images/speedy-van-highlands-luton-hero.webp',
  },
  mobile: {
    avif: '/images/speedy-van-highlands-luton-hero-1280.avif',
    webp: '/images/speedy-van-highlands-luton-hero-1280.webp',
  },
  narrow: {
    avif: '/images/speedy-van-highlands-luton-hero-440.avif',
    webp: '/images/speedy-van-highlands-luton-hero-440.webp',
  },
};

export function HeroBackgroundImage(): ReactNode {
  return (
    <>
      <link as="image" fetchPriority="high" href={artwork.desktop.avif} media="(min-width: 1024px)" rel="preload" type="image/avif" />
      <link as="image" fetchPriority="high" href={artwork.mobile.avif} media="(width > 440px) and (width < 1024px)" rel="preload" type="image/avif" />
      <link as="image" fetchPriority="high" href={artwork.narrow.avif} media="(max-width: 440px)" rel="preload" type="image/avif" />
      <picture aria-hidden="true" className="hero-background-image">
        <source media="(min-width: 1024px)" srcSet={artwork.desktop.avif} type="image/avif" />
        <source media="(min-width: 1024px)" srcSet={artwork.desktop.webp} type="image/webp" />
        <source height={720} media="(max-width: 440px)" srcSet={artwork.narrow.avif} type="image/avif" width={440} />
        <source height={720} media="(max-width: 440px)" srcSet={artwork.narrow.webp} type="image/webp" width={440} />
        <source srcSet={artwork.mobile.avif} type="image/avif" />
        <Image alt="" fetchPriority="high" height={720} loading="eager" src={artwork.mobile.webp} unoptimized width={1280} />
      </picture>
    </>
  );
}
