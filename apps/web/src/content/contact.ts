export const floatingContactCopy = {
  label: 'Contact Speedy Van',
  help: 'Help',
  open: 'Open help options',
  close: 'Close help options',
  greeting: 'Need a hand with your move?',
  whatsapp: 'WhatsApp',
  call: 'Call us',
  whatsappLabel: 'WhatsApp Speedy Van (opens in a new tab)',
  message: "Hi Speedy Van! I'd like some help with my move. Could you help me with availability and a quote?",
  callLabel: (phone: string): string => `Call Speedy Van on ${phone}`,
} as const;
