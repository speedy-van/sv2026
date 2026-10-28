import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import { durations, easings } from '@sv/tokens';
import Image from 'next/image';
import type { CSSProperties, ReactNode } from 'react';
import { brandLogo } from '@/content/brand';

const logoMotionStyle: CSSProperties & Record<`--logo-${string}`, string> = {
  '--logo-motion-duration': durations.reveal,
  '--logo-response-duration': durations.base,
  '--logo-motion-ease': easings.standard,
};

export function Logo({ inverse = false }: { inverse?: boolean }): ReactNode {
  return (
    <Link aria-label="Speedy Van home" className="logo" href="/" style={{ ...logoMotionStyle, color: inverse ? 'white' : undefined }}>
      <span aria-hidden="true" className="logo-badge">
        <Image alt="" className="logo-badge-image" height={44} sizes={inverse ? '44px' : '(max-width: 479px) 36px, 44px'} src={brandLogo.src} width={44} />
      </span>
      <span>Speedy Van</span>
    </Link>
  );
}
