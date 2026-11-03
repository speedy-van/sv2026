import { VISITOR_PRESENCE_COOKIE_NAME } from '@sv/contracts';

export type ConsentCategory = 'necessary' | 'analytics' | 'advertising';
export const consentSaveError =
  "Your cookie preferences could not be saved. Check your browser's cookie settings and try again.";

export const liveChatPrivacyNotice = {
  heading: 'Website chat',
  body: 'If you use website chat, your messages and optional name are stored so the Speedy Van admin team can read and reply. A necessary, secure chat cookie connects this browser to the conversation for 30 days. Please do not send card details or passwords in chat.',
} as const;

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
    name: 'sv_chat',
    purpose: 'Connects this browser to its website chat so the admin team can reply; expires after 30 days.',
    setWhen: 'When you start a live chat, independently of analytics or advertising consent.',
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
    name: VISITOR_PRESENCE_COOKIE_NAME,
    purpose:
      'An anonymous session identifier for counting consenting browsers active within the last 90 seconds.',
    setWhen: 'Only after analytics consent; session cookie.',
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
