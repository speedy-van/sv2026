import Link from 'next/link';
import type { ReactNode } from 'react';

export function Logo({ inverse = false }: { inverse?: boolean }): ReactNode {
  return (
    <Link aria-label="Speedy Van home" className="logo" href="/" style={{ color: inverse ? 'white' : undefined }}>
      <span aria-hidden="true" className="logo-glyph" />
      <span>Speedy Van</span>
    </Link>
  );
}
