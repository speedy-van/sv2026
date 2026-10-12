export type ConsentCategory = 'necessary' | 'analytics' | 'advertising';

export interface CookieInventoryItem {
  category: ConsentCategory;
  name: string;
  purpose: string;
  setWhen: string;
}

export const cookieInventory: CookieInventoryItem[] = [
  {
    category: 'necessary',
    name: 'sv_consent',
    purpose: 'Remembers cookie choices.',
    setWhen: 'After a consent choice.',
  },
  {
    category: 'necessary',
    name: 'sv_manage',
    purpose: 'Keeps a customer manage-booking session.',
    setWhen: 'After opening a manage link.',
  },
  {
    category: 'necessary',
    name: '__stripe_mid, __stripe_sid',
    purpose: 'Stripe fraud prevention on payment pages.',
    setWhen: 'Only on payment pages.',
  },
  {
    category: 'necessary',
    name: 'sessionStorage sv-booking-draft-v1',
    purpose: 'Keeps the booking form while it is being filled in.',
    setWhen: 'During the booking flow.',
  },
  {
    category: 'analytics',
    name: '_ga, _ga_*',
    purpose: 'Google Analytics statistics.',
    setWhen: 'After analytics consent.',
  },
  {
    category: 'advertising',
    name: '_gcl_*',
    purpose: 'Google Ads conversion measurement.',
    setWhen: 'After advertising consent.',
  },
];
