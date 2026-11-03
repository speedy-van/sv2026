import { CONSENT_MAX_AGE_SECONDS, VISITOR_HEARTBEAT_INTERVAL_SECONDS } from '@sv/contracts';
import type { SavedConsent } from './consent';

const endpoint = '/api/v1/visitors/presence';
const requestTimeoutMs = 10_000;
const heartbeatMs = VISITOR_HEARTBEAT_INTERVAL_SECONDS * 1000;

export interface VisitorPresenceEnvironment {
  fetch: typeof fetch;
  locks?: Pick<LockManager, 'request'>;
  readConsent(): SavedConsent | null;
  isVisible(): boolean;
  subscribeConsent(listener: () => void): () => void;
  subscribeVisibility(listener: () => void): () => void;
  subscribeOnline(listener: () => void): () => void;
}
interface PendingRequest {
  controller: AbortController;
  timeout: ReturnType<typeof setTimeout>;
  started: boolean;
}

export function startVisitorPresence(environment: VisitorPresenceEnvironment): () => void {
  let stopped = false;
  let hadAnalytics = false;
  let withdrawalRequested = false;
  let failures = 0;
  let retryAt = 0;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let post: PendingRequest | null = null;
  let removal: PendingRequest | null = null;

  function isStopped(): boolean {
    return stopped;
  }
  function needsWithdrawal(): boolean {
    return withdrawalRequested;
  }

  function clearHeartbeat(): void {
    clearTimeout(heartbeat);
    heartbeat = undefined;
  }
  function abortHeartbeat(): void {
    const request = post;
    post = null;
    if (request) {
      clearTimeout(request.timeout);
      request.controller.abort();
    }
  }
  function scheduleHeartbeat(delay: number): void {
    clearHeartbeat();
    heartbeat = setTimeout(synchronize, delay);
  }
  function options(method: 'POST' | 'DELETE', signal: AbortSignal): RequestInit {
    return {
      method,
      body: '{}',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      referrerPolicy: 'no-referrer',
      signal,
    };
  }
  function pending(): PendingRequest {
    const controller = new AbortController();
    return {
      controller,
      started: false,
      timeout: setTimeout(() => {
        controller.abort();
      }, requestTimeoutMs),
    };
  }

  async function send(method: 'POST' | 'DELETE', request: PendingRequest): Promise<Response | undefined> {
    const execution = { entered: false };
    async function insideLock(): Promise<Response | undefined> {
      execution.entered = true;
      if (isStopped() || request.controller.signal.aborted) return;
      if (
        method === 'POST' &&
        (!environment.readConsent()?.analytics || !environment.isVisible() || needsWithdrawal())
      )
        return;
      request.started = true;
      return environment.fetch(endpoint, options(method, request.controller.signal));
    }
    if (!environment.locks) return insideLock();
    try {
      return await environment.locks.request(
        'sv-visitor-presence',
        { mode: 'exclusive', signal: request.controller.signal },
        insideLock,
      );
    } catch (cause) {
      if (
        !execution.entered &&
        !request.controller.signal.aborted &&
        cause instanceof Error &&
        (cause.name === 'SecurityError' || cause.name === 'NotSupportedError')
      )
        return insideLock();
      throw cause;
    }
  }

  async function removePresence(): Promise<void> {
    if (stopped || post || removal || !withdrawalRequested) return;
    withdrawalRequested = false;
    const request = pending();
    removal = request;
    try {
      await send('DELETE', request);
    } catch {
      // Cleanup is best effort. The server counts only the bounded active window.
    } finally {
      clearTimeout(request.timeout);
      removal = null;
      if (!isStopped()) synchronize();
    }
  }

  async function sendHeartbeat(): Promise<void> {
    if (stopped || post || removal || withdrawalRequested) return;
    const request = pending();
    post = request;
    let succeeded = false;
    try {
      const response = await send('POST', request);
      succeeded = response?.ok === true && !request.controller.signal.aborted;
    } catch {
      // Optional measurement failures use a bounded delay, without replaying a queue.
    } finally {
      clearTimeout(request.timeout);
    }
    if (post !== request) return;
    post = null;
    if (isStopped()) return;
    if (needsWithdrawal()) {
      void removePresence();
      return;
    }
    if (!environment.readConsent()?.analytics || !environment.isVisible()) {
      synchronize();
      return;
    }
    failures = succeeded ? 0 : Math.min(failures + 1, 5);
    const delay = succeeded ? heartbeatMs : Math.min(300_000, heartbeatMs * 2 ** (failures - 1));
    retryAt = succeeded ? 0 : Date.now() + delay;
    scheduleHeartbeat(delay);
  }

  function synchronize(): void {
    if (stopped) return;
    clearTimeout(expiry);
    expiry = undefined;
    const consent = environment.readConsent();
    if (!consent?.analytics) {
      clearHeartbeat();
      if (hadAnalytics) {
        hadAnalytics = false;
        withdrawalRequested = true;
      }
      if (post && !post.started) abortHeartbeat();
      // A first heartbeat may still be setting its HttpOnly cookie. Its existing
      // timeout bounds settlement before withdrawal sends its cleanup request.
      if (!post) void removePresence();
      return;
    }
    if (!hadAnalytics) {
      hadAnalytics = true;
      failures = 0;
      retryAt = 0;
    }
    const remaining = Date.parse(consent.savedAt) + CONSENT_MAX_AGE_SECONDS * 1000 - Date.now();
    if (remaining <= 0) return;
    expiry = setTimeout(synchronize, Math.min(remaining, 2_147_483_647));
    if (withdrawalRequested || removal) {
      clearHeartbeat();
      if (!post) void removePresence();
      return;
    }
    if (!environment.isVisible()) {
      clearHeartbeat();
      abortHeartbeat();
      return;
    }
    if (post) return;
    const delay = retryAt - Date.now();
    if (delay > 0) scheduleHeartbeat(delay);
    else {
      clearHeartbeat();
      void sendHeartbeat();
    }
  }

  const subscriptions = [
    environment.subscribeConsent(synchronize),
    environment.subscribeVisibility(synchronize),
    environment.subscribeOnline(synchronize),
  ];
  synchronize();
  return () => {
    stopped = true;
    subscriptions.forEach((unsubscribe) => {
      unsubscribe();
    });
    clearHeartbeat();
    clearTimeout(expiry);
    abortHeartbeat();
    if (removal) {
      clearTimeout(removal.timeout);
      removal.controller.abort();
      removal = null;
    }
  };
}
