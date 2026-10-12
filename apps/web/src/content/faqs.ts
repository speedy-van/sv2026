export interface FaqSeed {
  category: string;
  question: string;
  answer: string;
  sortOrder: number;
}

export const FAQ_SEED: FaqSeed[] = [
  {
    category: 'BOOKING',
    question: 'How do I get a price?',
    answer:
      "Choose what you're moving, add both addresses, floors and your items. You'll see a fixed price for every morning, afternoon and evening slot over the next four weeks.",
    sortOrder: 10,
  },
  {
    category: 'PRICING',
    question: 'Is the price fixed?',
    answer:
      "Yes, for the details you give us. If there's more to move or harder access on the day than you told us, we'll agree the extra cost with you before doing the extra work.",
    sortOrder: 20,
  },
  {
    category: 'PRICING',
    question: 'Why does the price change by day and time?',
    answer:
      "Demand isn't even. Weekends add {weekend}%, summer months add {peak}%, the last {n} days of the month add {eom}%, and booking for today or the next two days costs more. Afternoons are the cheapest time of day.",
    sortOrder: 30,
  },
  {
    category: 'BOOKING',
    question: 'How far ahead can I book online?',
    answer: 'Up to {calendarDays} days ahead. For later dates, call {phone}.',
    sortOrder: 40,
  },
  {
    category: 'BOOKING',
    question: 'Can I book for today?',
    answer: 'Yes, if a slot is still free and starts at least {minLeadHours} hours from now.',
    sortOrder: 50,
  },
  {
    category: 'PAYMENT',
    question: 'When do I pay?',
    answer: 'In full when you book, by card, Apple Pay or Google Pay. Your booking is confirmed as soon as the payment goes through.',
    sortOrder: 60,
  },
  {
    category: 'PAYMENT',
    question: 'Is paying online safe?',
    answer: 'Payments are processed by Stripe. We never see or store your card number.',
    sortOrder: 70,
  },
  {
    category: 'CHANGES',
    question: 'Can I change my moving date?',
    answer:
      'Yes, from your booking page until {rescheduleHours} hours before your slot. If the new slot costs more you pay the difference; if it costs less we refund it.',
    sortOrder: 80,
  },
  {
    category: 'CHANGES',
    question: 'How do I cancel?',
    answer:
      "From your booking page. Cancel {freeHours}+ hours before your slot for a full refund; between {noRefundHours} and {freeHours} hours we refund {latePercent}%; inside {noRefundHours} hours there's no refund.",
    sortOrder: 90,
  },
  {
    category: 'ON_THE_DAY',
    question: 'Can I track my van?',
    answer: "Yes. On moving day you'll get a link showing your van on a map and when it will arrive.",
    sortOrder: 100,
  },
  {
    category: 'ON_THE_DAY',
    question: 'What if I have more items than I booked?',
    answer: 'Tell us as soon as you can. Your driver will confirm any extra cost with you before loading, and you can pay it online.',
    sortOrder: 110,
  },
  {
    category: 'COVERAGE',
    question: 'Which areas do you cover?',
    answer: "All of mainland Scotland, priced instantly. Island moves that need a ferry are priced by our team - you'll get a fixed price by email.",
    sortOrder: 120,
  },
  {
    category: 'COVERAGE',
    question: 'Do you move to and from England?',
    answer: '{crossBorderMoves ? "Yes - at least one address needs to be in Scotland." : "Not at the moment. We cover moves within Scotland."}',
    sortOrder: 130,
  },
  {
    category: 'ITEMS',
    question: 'Do I need to pack everything myself?',
    answer: 'You can, or add packing help when you book.',
    sortOrder: 140,
  },
  {
    category: 'ITEMS',
    question: "Is there anything you can't move?",
    answer: 'Owner to write: hazardous materials, gas bottles, fuel, etc.',
    sortOrder: 150,
  },
  {
    category: 'PAYMENT',
    question: 'Will I get a receipt?',
    answer: 'Yes, by email when you pay and again when your move is complete.',
    sortOrder: 160,
  },
];
