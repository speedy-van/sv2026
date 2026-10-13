export interface JobCard {
  bookingId: string;
  customer: string;
  dispatch: 'Driver confirmed' | 'Needs a driver' | 'Offered';
  pricePence: number;
  reference: string;
  route: string;
  service: string;
  slot: 'Afternoon' | 'Evening' | 'Morning';
  stage: string;
}

export interface MenuSection {
  description: string;
  key: string;
  title: string;
}

export const dashboardJobs: JobCard[] = [
  {
    bookingId: 'booking_glasgow',
    customer: 'Sarah M.',
    dispatch: 'Needs a driver',
    pricePence: 15890,
    reference: 'SV-8K2Q4P',
    route: 'Paisley to Edinburgh',
    service: 'Man and van',
    slot: 'Morning',
    stage: 'Confirmed'
  },
  {
    bookingId: 'booking_aberdeen',
    customer: 'David R.',
    dispatch: 'Driver confirmed',
    pricePence: 22400,
    reference: 'SV-3M9T7A',
    route: 'Aberdeen to Dundee',
    service: 'House removals',
    slot: 'Afternoon',
    stage: 'En route'
  }
];

export const moreSections: MenuSection[] = [
  { description: 'Quote requests and abandoned checkouts', key: 'leads', title: 'Leads' },
  { description: 'Customer history, exports and anonymise', key: 'customers', title: 'Customers' },
  { description: 'Versions, editor, simulator and approval', key: 'pricing', title: 'Pricing' },
  { description: 'Catalogue items and presets', key: 'items', title: 'Items' },
  { description: 'Moderate pending and published reviews', key: 'reviews', title: 'Reviews' },
  { description: 'Locations, FAQs, banner and SEO switches', key: 'content', title: 'Content' },
  { description: 'Contact form inbox', key: 'messages', title: 'Messages' },
  { description: 'Vans, MOT and insurance dates', key: 'fleet', title: 'Fleet' },
  { description: 'Driver earnings and payout history', key: 'payouts', title: 'Payouts' },
  { description: 'Revenue, funnel, areas and exports', key: 'reports', title: 'Reports' },
  { description: 'Invite staff and revoke sessions', key: 'team', title: 'Team' },
  { description: 'Company, operations, apps and launch', key: 'settings', title: 'Settings' },
  { description: 'Unread notifications and deep links', key: 'notifications', title: 'Notifications' },
  { description: 'Outbox, webhooks, cron and push health', key: 'system', title: 'System health' },
  { description: 'Filter by booking, user or action', key: 'audit', title: 'Audit log' },
  { description: 'Profile, devices, app lock and sign out', key: 'account', title: 'Account' }
];

export const bookingSheets = [
  'Assign driver',
  'Offer to drivers',
  'Unassign',
  'Edit details',
  'Re-price',
  'Reschedule',
  'Cancel booking',
  'Refund',
  'Extra charge',
  'Record offline payment',
  'Resend email'
] as const;

export const phoneBookingSteps = [
  'Customer',
  'Move',
  'Items',
  'Prices',
  'Payment'
] as const;
