export interface GoogleTagConfig {
  analyticsId: string;
  adsId: string;
  purchaseLabel: string;
}

/** Public, build-time IDs only. Missing or malformed destinations remain disabled. */
export function googleTagConfig(): GoogleTagConfig {
  const analyticsId = process.env.NEXT_PUBLIC_GA4_ID?.trim() ?? '';
  const adsId = process.env.NEXT_PUBLIC_GADS_ID?.trim() ?? '';
  const purchaseLabel = process.env.NEXT_PUBLIC_GADS_PURCHASE_LABEL?.trim() ?? '';
  return {
    analyticsId: /^G-[A-Z0-9]+$/u.test(analyticsId) ? analyticsId : '',
    adsId: /^AW-\d+$/u.test(adsId) ? adsId : '',
    purchaseLabel: /^[A-Za-z0-9_-]+$/u.test(purchaseLabel) ? purchaseLabel : '',
  };
}
