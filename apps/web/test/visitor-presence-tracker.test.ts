import { CONSENT_CLOCK_SKEW_SECONDS, CONSENT_MAX_AGE_SECONDS, parseConsentCookie } from '@sv/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startVisitorPresence,
  type VisitorPresenceEnvironment,
} from '../src/components/consent/visitor-presence';

const stops: Array<() => void> = [];
const now = Date.parse('2031-03-01T12:00:00.000Z');
function choice(analytics: boolean, advertising = false, savedAt = new Date().toISOString()): string {
  return encodeURIComponent(JSON.stringify({ analytics, advertising, version: 1, savedAt }));
}
function fixture(raw: string | undefined = choice(true), visible = true) {
  let cookie: string | undefined = raw;
  let isVisible = visible;
  const consent = new Set<() => void>();
  const visibility = new Set<() => void>();
  const online = new Set<() => void>();
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
  const subscribe =
    (events: Set<() => void>) =>
    (listener: () => void): (() => void) => {
      events.add(listener);
      return () => {
        events.delete(listener);
      };
    };
  const environment: VisitorPresenceEnvironment = {
    fetch,
    readConsent: () => parseConsentCookie(cookie),
    isVisible: () => isVisible,
    subscribeConsent: subscribe(consent),
    subscribeVisibility: subscribe(visibility),
    subscribeOnline: subscribe(online),
  };
  return {
    fetch,
    environment,
    start() {
      const stop = startVisitorPresence(environment);
      stops.push(stop);
      return stop;
    },
    changeConsent(next: string | undefined) {
      cookie = next;
      consent.forEach((listener) => {
        listener();
      });
    },
    setVisible(next: boolean) {
      isVisible = next;
      visibility.forEach((listener) => {
        listener();
      });
    },
    online() {
      online.forEach((listener) => {
        listener();
      });
    },
    subscriptionCount() {
      return consent.size + visibility.size + online.size;
    },
  };
}
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (!resolvePromise) throw new Error('Deferred response not ready.');
      resolvePromise(value);
    },
  };
}
function abortedResponse(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener(
      'abort',
      () => {
        reject(new DOMException('Test request aborted.', 'AbortError'));
      },
      { once: true },
    );
  });
}
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

class TestLocks implements Pick<LockManager, 'request'> {
  readonly names: string[] = [];
  private held = false;
  private queue: Array<() => void> = [];

  constructor(private unavailable = false) {}

  request<T>(name: string, callback: LockGrantedCallback<T>): Promise<Awaited<T>>;
  request<T>(name: string, options: LockOptions, callback: LockGrantedCallback<T>): Promise<Awaited<T>>;
  request<T>(
    name: string,
    input: LockOptions | LockGrantedCallback<T>,
    supplied?: LockGrantedCallback<T>,
  ): Promise<Awaited<T>> {
    const options = typeof input === 'function' ? {} : input;
    const callback = typeof input === 'function' ? input : supplied;
    if (this.unavailable) return Promise.reject(new DOMException('Test API unavailable.', 'SecurityError'));
    if (!callback) return Promise.reject(new Error('The test lock requires a callback.'));
    this.names.push(name);
    return new Promise<Awaited<T>>((resolve, reject) => {
      let granted = false;
      const abort = (): void => {
        if (granted) return;
        this.queue = this.queue.filter((entry) => entry !== run);
        options.signal?.removeEventListener('abort', abort);
        reject(new DOMException('Test lock wait aborted.', 'AbortError'));
        this.pump();
      };
      const run = (): void => {
        if (options.signal?.aborted) {
          abort();
          return;
        }
        granted = true;
        this.held = true;
        options.signal?.removeEventListener('abort', abort);
        const execute = async (): Promise<Awaited<T>> => {
          return await callback({ name, mode: options.mode ?? 'exclusive' });
        };
        void execute()
          .then(resolve, reject)
          .finally(() => {
            this.held = false;
            this.pump();
          });
      };
      this.queue.push(run);
      options.signal?.addEventListener('abort', abort, { once: true });
      this.pump();
    });
  }

  private pump(): void {
    if (!this.held) this.queue.shift()?.();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => {
  stops.splice(0).forEach((stop) => {
    stop();
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('consent-gated anonymous visitor heartbeat', () => {
  it.each([
    ['no choice', undefined],
    ['rejected', choice(false)],
    ['advertising only', choice(false, true)],
    ['malformed', '%broken'],
    ['expired', choice(true, false, new Date(now - CONSENT_MAX_AGE_SECONDS * 1000).toISOString())],
    ['future', choice(true, false, new Date(now + CONSENT_CLOCK_SKEW_SECONDS * 1000 + 1).toISOString())],
  ])('sends no request for %s consent', async (_label, raw) => {
    const tab = fixture(raw ?? '');
    tab.start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(tab.fetch).not.toHaveBeenCalled();
  });

  it('starts immediately after analytics opt-in and sends only an empty same-origin request without a referrer', async () => {
    const tab = fixture('');
    tab.start();
    tab.changeConsent(choice(true));
    await flush();
    expect(tab.fetch).toHaveBeenCalledTimes(1);
    expect(tab.fetch.mock.calls[0]?.[0]).toBe('/api/v1/visitors/presence');
    const options = tab.fetch.mock.calls[0]?.[1];
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect({ ...options, signal: undefined }).toEqual({
      method: 'POST',
      body: '{}',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      referrerPolicy: 'no-referrer',
      signal: undefined,
    });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(tab.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tab.fetch).toHaveBeenCalledTimes(2);
  });

  it('sends the first consented heartbeat immediately when the browser choice clock is slightly ahead', async () => {
    const tab = fixture(choice(true, false, new Date(now + 1500).toISOString()));
    tab.start();
    await flush();
    expect(tab.fetch).toHaveBeenCalledTimes(1);
    expect(tab.fetch.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('does not refresh hidden tabs, resumes immediately when visible and never deletes on hide or unmount', async () => {
    const tab = fixture(choice(true), false);
    const stop = tab.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tab.fetch).not.toHaveBeenCalled();
    tab.setVisible(true);
    await flush();
    expect(tab.fetch).toHaveBeenCalledTimes(1);
    tab.setVisible(false);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(tab.fetch).toHaveBeenCalledTimes(1);
    tab.setVisible(true);
    await flush();
    expect(tab.fetch).toHaveBeenCalledTimes(2);
    stop();
    expect(tab.subscriptionCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(tab.fetch).toHaveBeenCalledTimes(2);
    expect(tab.fetch.mock.calls.every(([, options]) => options?.method === 'POST')).toBe(true);
  });

  it('aborts a hidden in-flight heartbeat without deleting a cookie shared with other tabs', async () => {
    const tab = fixture();
    tab.fetch.mockImplementation((_input, options) => abortedResponse(options?.signal));
    tab.start();
    const signal = tab.fetch.mock.calls[0]?.[1]?.signal;
    tab.setVisible(false);
    await flush();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(tab.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not overlap requests when visibility, online and consent notifications repeat', async () => {
    const tab = fixture();
    const response = deferred<Response>();
    tab.fetch.mockReturnValueOnce(response.promise);
    tab.start();
    for (let index = 0; index < 10; index += 1) {
      tab.online();
      tab.setVisible(true);
      tab.changeConsent(choice(true));
    }
    expect(tab.fetch).toHaveBeenCalledTimes(1);
    response.resolve(new Response('{}'));
    await flush();
    expect(tab.fetch).toHaveBeenCalledTimes(1);
  });

  it('settles an initial heartbeat before withdrawal cleanup so its session cookie can be included', async () => {
    const tab = fixture();
    const response = deferred<Response>();
    tab.fetch.mockReturnValueOnce(response.promise);
    tab.start();
    const signal = tab.fetch.mock.calls[0]?.[1]?.signal;
    tab.changeConsent(choice(false));
    expect(signal?.aborted).toBe(false);
    expect(tab.fetch).toHaveBeenCalledTimes(1);
    response.resolve(new Response('{}'));
    await flush();
    expect(tab.fetch).toHaveBeenCalledTimes(2);
    expect(tab.fetch.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'DELETE',
        body: '{}',
        credentials: 'same-origin',
        referrerPolicy: 'no-referrer',
      }),
    );
    await vi.advanceTimersByTimeAsync(300_000);
    expect(tab.fetch).toHaveBeenCalledTimes(2);
  });

  it('bounds withdrawal settlement to ten seconds and makes one cleanup attempt without a replay queue', async () => {
    const tab = fixture();
    tab.fetch.mockImplementationOnce((_input, options) => abortedResponse(options?.signal));
    tab.fetch.mockRejectedValueOnce(new Error('Mock cleanup connection failure.'));
    tab.start();
    tab.changeConsent(choice(false));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(tab.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tab.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(tab.fetch).toHaveBeenCalledTimes(2);
    expect(tab.fetch.mock.calls[1]?.[1]?.method).toBe('DELETE');
    await vi.advanceTimersByTimeAsync(600_000);
    expect(tab.fetch).toHaveBeenCalledTimes(2);
  });

  it('waits for withdrawal cleanup before a new opt-in heartbeat', async () => {
    const tab = fixture();
    const removed = deferred<Response>();
    tab.fetch.mockImplementation((_input, options) =>
      options?.method === 'DELETE' ? removed.promise : Promise.resolve(new Response('{}')),
    );
    tab.start();
    await flush();
    tab.changeConsent(choice(false));
    tab.changeConsent(choice(true));
    expect(tab.fetch).toHaveBeenCalledTimes(2);
    removed.resolve(new Response('{}'));
    await flush();
    expect(tab.fetch).toHaveBeenCalledTimes(3);
    expect(tab.fetch.mock.calls.map(([, options]) => options?.method)).toEqual(['POST', 'DELETE', 'POST']);
  });

  it('expires an old analytics choice at its exact boundary and cleans up without another heartbeat', async () => {
    const tab = fixture(
      choice(true, false, new Date(now - CONSENT_MAX_AGE_SECONDS * 1000 + 1000).toISOString()),
    );
    tab.start();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(tab.fetch.mock.calls.map(([, options]) => options?.method)).toEqual(['POST', 'DELETE']);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(tab.fetch).toHaveBeenCalledTimes(2);
  });

  it('uses increasing bounded backoff and ignores event storms after network or HTTP failures', async () => {
    const tab = fixture();
    tab.fetch
      .mockRejectedValueOnce(new Error('Mock network failure.'))
      .mockResolvedValue(new Response('{}', { status: 503 }));
    tab.start();
    await flush();
    for (const delay of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
      const count = tab.fetch.mock.calls.length;
      for (let index = 0; index < 10; index += 1) {
        tab.online();
        tab.setVisible(true);
      }
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(tab.fetch).toHaveBeenCalledTimes(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(tab.fetch).toHaveBeenCalledTimes(count + 1);
    }
    tab.fetch.mockResolvedValue(new Response('{}'));
    await vi.advanceTimersByTimeAsync(300_000);
    const count = tab.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(tab.fetch).toHaveBeenCalledTimes(count + 1);
  });

  it('aborts a heartbeat on unmount, clears all subscriptions and never sends a deletion', async () => {
    const tab = fixture();
    tab.fetch.mockImplementation((_input, options) => abortedResponse(options?.signal));
    const stop = tab.start();
    stop();
    await flush();
    expect(tab.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(tab.subscriptionCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(tab.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps another tab active when one tab leaves and does not invent per-tab identifiers', async () => {
    const first = fixture();
    const second = fixture();
    const stopFirst = first.start();
    second.start();
    await flush();
    stopFirst();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(first.fetch.mock.calls.map(([, options]) => options?.method)).toEqual(['POST']);
    expect(second.fetch.mock.calls.map(([, options]) => options?.method)).toEqual(['POST', 'POST']);
    expect(
      second.fetch.mock.calls.every(
        ([, options]) => options?.body === '{}' && options.credentials === 'same-origin',
      ),
    ).toBe(true);
    second.changeConsent(choice(false));
    await flush();
    expect(second.fetch.mock.calls.at(-1)?.[1]?.method).toBe('DELETE');
  });

  it('serializes two first-tab requests until the first response sets their shared browser cookie', async () => {
    const locks = new TestLocks();
    const first = fixture();
    const second = fixture();
    first.environment.locks = locks;
    second.environment.locks = locks;
    const response = deferred<Response>();
    let visitorCookie: string | null = null;
    const identities = new Set<string>();
    const observed: Array<string | null> = [];
    first.fetch.mockImplementationOnce(async () => {
      identities.add('anonymous-session-1');
      const result = await response.promise;
      visitorCookie = 'anonymous-session-1';
      return result;
    });
    second.fetch.mockImplementationOnce(() => {
      observed.push(visitorCookie);
      identities.add(visitorCookie ?? 'anonymous-session-2');
      return Promise.resolve(new Response('{}'));
    });
    first.start();
    second.start();
    await flush();
    expect(first.fetch).toHaveBeenCalledTimes(1);
    expect(second.fetch).not.toHaveBeenCalled();
    response.resolve(new Response('{}'));
    await flush();
    expect(second.fetch).toHaveBeenCalledTimes(1);
    expect(observed).toEqual(['anonymous-session-1']);
    expect(identities.size).toBe(1);
    expect(locks.names).toEqual(['sv-visitor-presence', 'sv-visitor-presence']);
  });

  it('cancels a queued lock after the ten-second deadline without sending a late heartbeat', async () => {
    const locks = new TestLocks();
    const held = deferred<undefined>();
    const holder = locks.request('sv-visitor-presence', () => held.promise);
    const tab = fixture();
    tab.environment.locks = locks;
    tab.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tab.fetch).not.toHaveBeenCalled();
    held.resolve(undefined);
    await holder;
    await flush();
    expect(tab.fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(tab.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['hidden', 'unmount'] as const)('cancels an unsent queued heartbeat on %s', async (action) => {
    const locks = new TestLocks();
    const held = deferred<undefined>();
    const holder = locks.request('sv-visitor-presence', () => held.promise);
    const tab = fixture();
    tab.environment.locks = locks;
    const stop = tab.start();
    if (action === 'hidden') tab.setVisible(false);
    else stop();
    held.resolve(undefined);
    await holder;
    await flush();
    expect(tab.fetch).not.toHaveBeenCalled();
  });

  it('rechecks visibility immediately after a queued lock is granted', async () => {
    const locks = new TestLocks();
    const held = deferred<undefined>();
    const holder = locks.request('sv-visitor-presence', () => held.promise);
    const tab = fixture();
    tab.environment.locks = locks;
    let visible = true;
    tab.environment.isVisible = () => visible;
    tab.start();
    visible = false;
    held.resolve(undefined);
    await holder;
    await flush();
    expect(tab.fetch).not.toHaveBeenCalled();
  });

  it('rechecks withdrawn consent after a queued lock and sends only serialized cleanup', async () => {
    const locks = new TestLocks();
    const held = deferred<undefined>();
    const holder = locks.request('sv-visitor-presence', () => held.promise);
    const tab = fixture();
    tab.environment.locks = locks;
    tab.start();
    tab.environment.readConsent = () => null;
    held.resolve(undefined);
    await holder;
    await flush();
    expect(tab.fetch.mock.calls.map(([, options]) => options?.method)).toEqual(['DELETE']);
    expect(locks.names).toEqual(['sv-visitor-presence', 'sv-visitor-presence', 'sv-visitor-presence']);
  });

  it('withdraws a queued heartbeat before grant and runs cleanup under the same lock', async () => {
    const locks = new TestLocks();
    const held = deferred<undefined>();
    const holder = locks.request('sv-visitor-presence', () => held.promise);
    const tab = fixture();
    tab.environment.locks = locks;
    tab.start();
    tab.changeConsent(choice(false));
    expect(tab.fetch).not.toHaveBeenCalled();
    held.resolve(undefined);
    await holder;
    await flush();
    expect(tab.fetch.mock.calls.map(([, options]) => options?.method)).toEqual(['DELETE']);
  });

  it('keeps measurement working when Web Locks is absent or access is unavailable', async () => {
    const absent = fixture();
    absent.start();
    await flush();
    expect(absent.fetch).toHaveBeenCalledTimes(1);
    const unavailable = fixture();
    unavailable.environment.locks = new TestLocks(true);
    unavailable.start();
    await flush();
    expect(unavailable.fetch).toHaveBeenCalledTimes(1);
  });
});
