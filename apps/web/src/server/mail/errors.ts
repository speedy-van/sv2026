import 'server-only';

export class MailTransientError extends Error {
  constructor(readonly code = 'MAIL_UNAVAILABLE') { super(code); this.name = 'MailTransientError'; }
}
export class MailPermanentError extends Error {
  constructor(readonly code = 'MAIL_REJECTED') { super(code); this.name = 'MailPermanentError'; }
}
export class MailReviewRequiredError extends Error {
  constructor(readonly code = 'MAIL_DELIVERY_UNCERTAIN') { super(code); this.name = 'MailReviewRequiredError'; }
}
export class MailDeferredError extends Error {
  constructor(readonly retryAt: Date, readonly code = 'MAIL_QUOTA_DEFERRED') { super(code); this.name = 'MailDeferredError'; }
}
