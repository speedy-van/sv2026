export const floatingContactCopy = {
  label: 'Contact Speedy Van',
  greeting: 'Need a hand with your move?',
  whatsapp: 'WhatsApp',
  whatsappLabel: 'WhatsApp Speedy Van (opens in a new tab)',
  message: "Hi Speedy Van! I'd like some help with my move. Could you help me with availability and a quote?",
  callLabel: (phone: string): string => `Call Speedy Van on ${phone}`,
} as const;
