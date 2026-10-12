import type { PublicSettings } from '@sv/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';

export function SiteBanner({ banner }: { banner: PublicSettings['siteBanner'] }): ReactNode {
  if (!banner.enabled || banner.text.length === 0) return null;

  return (
    <div className="site-banner" role="status">
      <div className="container">
        {banner.href ? <Link href={banner.href}>{banner.text}</Link> : <span>{banner.text}</span>}
      </div>
    </div>
  );
}
