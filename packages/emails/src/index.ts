import { formatGBP } from '@sv/contracts';
import {
  Body,
  Button,
  Container,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { render } from '@react-email/render';
import { createElement } from 'react';
import type { ReactElement } from 'react';

export const EMAIL_TEMPLATE_KEYS = [
  'booking-confirmed',
  'manage-link',
  'driver-assigned',
  'reminder-day-before',
  'on-the-way',
  'move-completed',
  'rescheduled',
  'cancelled',
  'refund-issued',
  'payment-received',
  'manual-quote-received',
  'manual-quote-ready',
  'manual-quote-declined',
  'extra-charge-request',
  'payment-link',
  'payment-after-expiry-refunded',
  'contact-received',
  'staff-login-code',
  'staff-invite',
  'admin-new-booking',
  'admin-manual-quote',
  'admin-dispute',
  'admin-daily-summary',
  'admin-system-alert',
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export interface EmailTemplateData {
  amountPence?: number;
  canonicalOrigin?: string;
  contactEmail?: string | null;
  customerName?: string;
  driverFirstName?: string;
  holdExpiresAt?: string;
  legalLine?: string | null;
  manageUrl?: string;
  message?: string;
  moveDateLabel?: string;
  oldMoveDateLabel?: string;
  payUrl?: string;
  preheader?: string;
  proofUrl?: string;
  reference?: string;
  refundPence?: number;
  reviewUrl?: string;
  role?: 'Admin' | 'Driver';
  routeLabel?: string;
  serviceLabel?: string;
  signInCode?: string;
  slotLabel?: string;
  subject?: string;
  trackingUrl?: string;
}

export interface RenderedEmail {
  html: string;
  subject: string;
  text: string;
}

interface TemplateCopy {
  body: string[];
  buttonLabel: string;
  buttonUrl: string;
  preheader: string;
  subject: string;
  title: string;
}

const styles = {
  body: { backgroundColor: '#EEF3F6', color: '#0B1F33', fontFamily: 'Arial, sans-serif', margin: '0' },
  button: {
    backgroundColor: '#FFC93C',
    borderRadius: '6px',
    color: '#0B1F33',
    display: 'inline-block',
    fontWeight: '700',
    minHeight: '48px',
    padding: '14px 22px',
    textDecoration: 'none',
  },
  card: { backgroundColor: '#FFFFFF', borderRadius: '8px', margin: '24px auto', padding: '28px', width: '560px' },
  footer: { color: '#51606B', fontSize: '12px', lineHeight: '18px' },
  h1: { color: '#0B1F33', fontSize: '24px', lineHeight: '31px', margin: '0 0 16px' },
  logo: { color: '#0B1F33', fontSize: '18px', fontWeight: '800', margin: '0 0 20px' },
  text: { color: '#0B1F33', fontSize: '15px', lineHeight: '23px', margin: '0 0 14px' },
} as const;

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function origin(data: EmailTemplateData): string {
  return data.canonicalOrigin ?? 'https://www.speedyvan.uk';
}

function absoluteUrl(data: EmailTemplateData, value: string | undefined): string {
  const fallback = origin(data);
  if (!value) return fallback;
  if (/^https?:\/\//.test(value)) return value;
  return new URL(value, fallback).toString();
}

function amount(data: EmailTemplateData, key: 'amountPence' | 'refundPence' = 'amountPence'): string {
  return formatGBP(data[key] ?? 0);
}

function ref(data: EmailTemplateData): string {
  return data.reference ?? 'SV-000000';
}

function dateLabel(data: EmailTemplateData): string {
  return data.moveDateLabel ?? 'your move date';
}

function slotLabel(data: EmailTemplateData): string {
  return data.slotLabel ?? 'your booked window';
}

function routeLabel(data: EmailTemplateData): string {
  return data.routeLabel ?? 'your pickup and drop-off';
}

function subjectFor(template: EmailTemplateKey, data: EmailTemplateData): string {
  if (data.subject) return clean(data.subject).slice(0, 60);
  const subjects: Record<EmailTemplateKey, string> = {
    'admin-daily-summary': `Today: ${data.message ?? 'moves and dispatch'}`,
    'admin-dispute': `Payment dispute on ${ref(data)}`,
    'admin-manual-quote': `Quote request: ${routeLabel(data)}`,
    'admin-new-booking': `New booking ${ref(data)}: ${amount(data)}`,
    'admin-system-alert': `Action needed: ${data.message ?? 'system alert'}`,
    'booking-confirmed': `You're booked: ${dateLabel(data)} (${ref(data)})`,
    cancelled: `Your booking ${ref(data)} is cancelled`,
    'contact-received': `We've got your message`,
    'driver-assigned': `${data.driverFirstName ?? 'Your driver'} is assigned`,
    'extra-charge-request': `Payment needed for your move (${ref(data)})`,
    'manage-link': `Your Speedy Van booking link`,
    'manual-quote-declined': `About your moving request`,
    'manual-quote-ready': `Your fixed price: ${amount(data)}`,
    'manual-quote-received': `We're pricing your move`,
    'move-completed': `Your move is complete (${ref(data)})`,
    'on-the-way': `${data.driverFirstName ?? 'Your driver'} is on the way`,
    'payment-after-expiry-refunded': `We've refunded your payment`,
    'payment-link': `Confirm your move: pay ${amount(data)}`,
    'payment-received': `Payment received: ${amount(data)}`,
    'refund-issued': `Refund of ${amount(data, 'refundPence')} on its way`,
    rescheduled: `Your move is now on ${dateLabel(data)}`,
    'reminder-day-before': `Tomorrow: your move, ${slotLabel(data)}`,
    'staff-invite': `You've been invited to Speedy Van ${data.role ?? 'Admin'}`,
    'staff-login-code': `Your Speedy Van sign-in code`,
  };
  return clean(subjects[template]).slice(0, 60);
}

function copyFor(template: EmailTemplateKey, data: EmailTemplateData): TemplateCopy {
  const manage = absoluteUrl(data, data.manageUrl ?? `/manage?ref=${encodeURIComponent(ref(data))}`);
  const pay = absoluteUrl(data, data.payUrl ?? `/pay/${encodeURIComponent(ref(data))}`);
  const track = absoluteUrl(data, data.trackingUrl ?? `/track/${encodeURIComponent(ref(data))}`);
  const review = absoluteUrl(data, data.reviewUrl ?? '/reviews');
  const subject = subjectFor(template, data);
  const common = `Booking reference ${ref(data)}.`;

  const templates: Record<EmailTemplateKey, Omit<TemplateCopy, 'subject'>> = {
    'admin-daily-summary': {
      body: [data.message ?? 'Today summary is ready for review in the admin app.'],
      buttonLabel: 'Open admin',
      buttonUrl: absoluteUrl(data, '/admin'),
      preheader: 'Daily operating summary.',
      title: 'Daily summary',
    },
    'admin-dispute': {
      body: [common, 'A payment dispute needs evidence: signature, photos, timestamps, GPS trail and customer emails.'],
      buttonLabel: 'Open booking',
      buttonUrl: manage,
      preheader: 'Payment dispute evidence is needed.',
      title: 'Payment dispute',
    },
    'admin-manual-quote': {
      body: [`Route: ${routeLabel(data)}.`, data.message ?? 'A customer requested manual pricing.'],
      buttonLabel: 'Price quote',
      buttonUrl: absoluteUrl(data, '/admin/manual-quotes'),
      preheader: 'A quote needs pricing.',
      title: 'Manual quote request',
    },
    'admin-new-booking': {
      body: [common, `Service: ${data.serviceLabel ?? 'Move'}.`, `Route: ${routeLabel(data)}.`, `Paid: ${amount(data)}.`],
      buttonLabel: 'Open booking',
      buttonUrl: manage,
      preheader: 'A new paid booking is ready for dispatch.',
      title: 'New booking',
    },
    'admin-system-alert': {
      body: [data.message ?? 'A system alert needs owner attention.'],
      buttonLabel: 'Open admin',
      buttonUrl: absoluteUrl(data, '/admin/system'),
      preheader: 'System action is needed.',
      title: 'System alert',
    },
    'booking-confirmed': {
      body: [
        common,
        `You're booked for ${dateLabel(data)}, ${slotLabel(data)}.`,
        `Route: ${routeLabel(data)}.`,
        `Amount paid: ${amount(data)}.`,
        'What happens next: we confirm dispatch, keep you updated by email, and send tracking when the driver is on the way.',
      ],
      buttonLabel: 'Manage booking',
      buttonUrl: manage,
      preheader: 'Your booking is confirmed.',
      title: 'You are booked',
    },
    cancelled: {
      body: [common, data.message ?? 'Your booking has been cancelled.', `Refund due: ${amount(data, 'refundPence')}.`],
      buttonLabel: 'Contact us',
      buttonUrl: absoluteUrl(data, '/contact'),
      preheader: 'Your booking has been cancelled.',
      title: 'Booking cancelled',
    },
    'contact-received': {
      body: [data.message ?? 'We have received your message and will reply as soon as possible.'],
      buttonLabel: 'Visit Speedy Van',
      buttonUrl: origin(data),
      preheader: 'We received your message.',
      title: 'Message received',
    },
    'driver-assigned': {
      body: [common, `${data.driverFirstName ?? 'Your driver'} will be your driver on ${dateLabel(data)}, ${slotLabel(data)}.`],
      buttonLabel: 'Manage booking',
      buttonUrl: manage,
      preheader: 'Your driver has been assigned.',
      title: 'Driver assigned',
    },
    'extra-charge-request': {
      body: [common, data.message ?? 'An approved extra charge is awaiting payment.', `Amount due: ${amount(data)}.`],
      buttonLabel: 'Pay now',
      buttonUrl: pay,
      preheader: 'A payment is needed for your move.',
      title: 'Payment needed',
    },
    'manage-link': {
      body: [common, 'Use this link to manage your booking. If you did not ask for this, you can ignore this email.'],
      buttonLabel: 'Manage booking',
      buttonUrl: manage,
      preheader: 'Your manage-booking link.',
      title: 'Your booking link',
    },
    'manual-quote-declined': {
      body: [data.message ?? 'We are sorry, but we cannot price this request online right now.', 'Call us if you want to discuss alternatives.'],
      buttonLabel: 'Contact us',
      buttonUrl: absoluteUrl(data, '/contact'),
      preheader: 'An update about your moving request.',
      title: 'About your request',
    },
    'manual-quote-ready': {
      body: [`Fixed price: ${amount(data)}.`, `Date and window: ${dateLabel(data)}, ${slotLabel(data)}.`, data.message ?? 'This price includes the move details you shared.'],
      buttonLabel: 'Pay now',
      buttonUrl: pay,
      preheader: 'Your fixed price is ready.',
      title: 'Fixed price ready',
    },
    'manual-quote-received': {
      body: [`Route: ${routeLabel(data)}.`, 'We will email your fixed price after reviewing the details.'],
      buttonLabel: 'Contact us',
      buttonUrl: absoluteUrl(data, '/contact'),
      preheader: 'We are pricing your move.',
      title: 'We are pricing your move',
    },
    'move-completed': {
      body: [common, 'Your move is complete.', `Receipt total: ${amount(data)}.`],
      buttonLabel: 'Review us',
      buttonUrl: review,
      preheader: 'Your move is complete.',
      title: 'Move complete',
    },
    'on-the-way': {
      body: [common, `${data.driverFirstName ?? 'Your driver'} is on the way.`, data.message ?? 'Track your move for live updates.'],
      buttonLabel: 'Track booking',
      buttonUrl: track,
      preheader: 'Your driver is on the way.',
      title: 'On the way',
    },
    'payment-after-expiry-refunded': {
      body: [
        common,
        'We are sorry — that slot filled while your payment was processing.',
        `We have refunded ${amount(data, 'refundPence')} in full.`,
        'Call us and we will help find another slot.',
      ],
      buttonLabel: 'Contact us',
      buttonUrl: absoluteUrl(data, '/contact'),
      preheader: 'Your payment has been refunded.',
      title: 'Payment refunded',
    },
    'payment-link': {
      body: [common, `Pay ${amount(data)} to confirm your move.`, `Hold expires: ${data.holdExpiresAt ?? 'soon'}.`],
      buttonLabel: 'Pay now',
      buttonUrl: pay,
      preheader: 'Confirm your move by paying online.',
      title: 'Confirm your move',
    },
    'payment-received': {
      body: [common, `We received ${amount(data)}.`, data.message ?? 'Your booking balance has been updated.'],
      buttonLabel: 'Manage booking',
      buttonUrl: manage,
      preheader: 'Payment received.',
      title: 'Payment received',
    },
    'refund-issued': {
      body: [common, `Your refund of ${amount(data, 'refundPence')} is on its way.`, 'It usually reaches your card within 5 to 10 working days.'],
      buttonLabel: 'Manage booking',
      buttonUrl: manage,
      preheader: 'Your refund is on its way.',
      title: 'Refund issued',
    },
    rescheduled: {
      body: [common, `Old date: ${data.oldMoveDateLabel ?? 'previous date'}.`, `New date: ${dateLabel(data)}, ${slotLabel(data)}.`],
      buttonLabel: 'Manage booking',
      buttonUrl: manage,
      preheader: 'Your move has been rescheduled.',
      title: 'Move rescheduled',
    },
    'reminder-day-before': {
      body: [common, `Tomorrow's window: ${slotLabel(data)}.`, `Addresses: ${routeLabel(data)}.`, data.message ?? 'Please keep access clear before we arrive.'],
      buttonLabel: 'Manage booking',
      buttonUrl: manage,
      preheader: 'Your move is tomorrow.',
      title: 'Move reminder',
    },
    'staff-invite': {
      body: [`You have been invited to Speedy Van ${data.role ?? 'Admin'}.`, 'Install the app, then sign in with your email code.'],
      buttonLabel: 'Open install link',
      buttonUrl: absoluteUrl(data, data.manageUrl ?? '/admin'),
      preheader: 'You have been invited to Speedy Van.',
      title: 'You are invited',
    },
    'staff-login-code': {
      body: [`Your sign-in code is ${data.signInCode ?? '000 000'}.`, 'The code expires soon. Never share it with anyone.'],
      buttonLabel: 'Open app',
      buttonUrl: absoluteUrl(data, data.manageUrl ?? '/admin'),
      preheader: 'Your sign-in code.',
      title: 'Sign-in code',
    },
  };

  return { ...templates[template], subject };
}

function emailNode(copy: TemplateCopy, data: EmailTemplateData): ReactElement {
  return createElement(
    Html,
    null,
    createElement(Preview, null, copy.preheader),
    createElement(
      Body,
      { style: styles.body },
      createElement(
        Container,
        { style: styles.card },
        createElement(Text, { style: styles.logo }, 'Speedy Van'),
        createElement(Heading, { as: 'h1', style: styles.h1 }, copy.title),
        createElement(Section, null, ...copy.body.map((line) => createElement(Text, { key: line, style: styles.text }, line))),
        createElement(Button, { href: copy.buttonUrl, style: styles.button }, copy.buttonLabel),
        createElement(Hr, null),
        createElement(
          Text,
          { style: styles.footer },
          data.legalLine ?? "You're getting this email because you booked or contacted Speedy Van.",
        ),
        createElement(Text, { style: styles.footer }, data.contactEmail ? `Contact: ${data.contactEmail}` : 'Contact Speedy Van for help.'),
      ),
    ),
  );
}

export async function renderEmailTemplate(template: EmailTemplateKey, data: EmailTemplateData = {}): Promise<RenderedEmail> {
  const copy = copyFor(template, data);
  const node = emailNode(copy, data);
  const html = await render(node, { pretty: true });
  const text = await render(node, { plainText: true });
  return {
    html,
    subject: copy.subject,
    text,
  };
}
