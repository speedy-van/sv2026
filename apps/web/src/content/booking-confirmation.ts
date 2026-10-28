export const bookingConfirmationCopy = {
  checking: {
    title: 'Checking your payment',
    message: 'Please wait while we check your payment and booking status.',
  },
  pending: {
    title: 'Payment not confirmed',
    message: 'We have not confirmed this payment. Your booking is not confirmed yet.',
  },
  failed: {
    title: 'Your payment did not go through',
    message:
      'Your booking is not confirmed. Try again with the same checkout, or choose another payment method.',
  },
  canceled: {
    title: 'Payment was not completed',
    message: 'The payment was canceled or left unfinished. Your booking is not confirmed.',
  },
  processing: {
    title: 'Your payment is processing',
    message:
      'We are waiting for the payment provider. Please do not make another payment while this one is processing. Check the status again shortly.',
  },
  received: {
    title: 'Payment received',
    message: 'We are confirming your booking. Check the status again shortly; you do not need to pay again.',
  },
  expired: {
    title: 'Your slot hold has ended',
    message: 'This checkout can no longer be used. Check current prices and choose an available time again.',
  },
  unavailable: {
    title: 'This booking is no longer awaiting payment',
    message: 'Use your booking email or contact our team if you need help with this booking.',
  },
  error: {
    title: 'We could not check your payment',
    message: 'We cannot confirm the payment status right now. Check again before making another payment.',
  },
  missing: {
    title: 'Confirmation link missing',
    message:
      'We could not find the booking connected to this payment. Return to the payment page in the browser where you started, or contact our team.',
  },
  noMatchingDraft:
    'To resume this checkout, use the same browser where you started the booking. Contact our team if those details are no longer available.',
  checkAgain: 'Check payment status',
  checkingAgain: 'Checking…',
  retryPayment: 'Try payment again',
  returnSavedCheckout: 'Return to saved checkout',
  seePrices: 'See prices again',
  contact: 'Contact our team',
  incompletePayment: 'Your payment was not completed. Try again or choose another payment method.',
  awaitingClosure:
    'Your hold has ended. Please check the payment status again or contact our team before starting another payment.',
  storageUnavailable:
    'Saved move details could not be restored in this browser. Your confirmation link can still be used to check the booking.',
  clearFailed: 'Your booking is confirmed, but some checkout details could not be updated on this device.',
} as const;
