import { ApiClientError } from '@sv/api-client';
import {
  BrowserAuthTokenResponseSchema,
  BrowserSessionLogoutResponseSchema,
  ErrorEnvelopeSchema,
  type BrowserAuthTokenResponse,
} from '@sv/contracts';

const signOutKey = 'sv-admin-signed-out';
const signOutEvent = 'sv-admin-sign-out';
const requestTimeoutMs = 15_000;
let cookieQueue: Promise<unknown> = Promise.resolve();
let browserOperation = 0;

interface BrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface BrowserLocation {
  hostname: string;
  protocol: string;
  port: string;
}
interface BrowserLocks {
  request<T>(name: string, options: { signal: AbortSignal }, operation: () => Promise<T>): Promise<T>;
}
type BrowserRuntime = {
  window?: EventTarget & { location?: BrowserLocation; localStorage: BrowserStorage };
  navigator?: { locks?: BrowserLocks };
};
const browserRuntime = globalThis as BrowserRuntime;

interface BrowserSessionOptions {
  baseUrl: string;
  fetch: typeof fetch;
  storage?: BrowserStorage;
  events?: EventTarget;
  locks?: BrowserLocks;
}

export function resolveBrowserApiBaseUrl(
  configured: string,
  location: BrowserLocation | null | undefined = browserRuntime.window?.location,
): string {
  if (!location) return configured;
  const hostname = location.hostname;
  const api = new URL(configured);
  if (
    location.protocol === 'http:' &&
    location.port === '8081' &&
    (hostname === 'localhost' || hostname === '127.0.0.1') &&
    api.protocol === 'http:' &&
    api.port === '3000' &&
    (api.hostname === 'localhost' || api.hostname === '127.0.0.1')
  )
    return new URL(`${api.protocol}//${hostname}:${api.port}${api.pathname}${api.search}${api.hash}`)
      .toString()
      .replace(/\/$/u, '');
  return api.toString().replace(/\/$/u, '');
}

/** Durable browser credentials stay in an HttpOnly server cookie, never JS storage. */
export class BrowserAdminSession {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #storage: BrowserSessionOptions['storage'];
  readonly #events: EventTarget | undefined;
  readonly #locks: BrowserSessionOptions['locks'];
  #signedOut = false;

  constructor(options: BrowserSessionOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/u, '');
    this.#fetch = options.fetch;
    this.#events = options.events ?? browserRuntime.window;
    this.#storage = options.storage;
    this.#locks = options.locks ?? browserRuntime.navigator?.locks;
  }

  isSignedOut(): boolean {
    if (this.#signedOut) return true;
    try {
      const marker = this.#getStorage()?.getItem(signOutKey);
      return marker !== null && marker !== undefined;
    } catch {
      throw new Error(
        'The browser could not read your saved sign-in preference. Check browser storage settings and try again.',
      );
    }
  }

  subscribeToSignOut(listener: () => void, onStorageError: (error: Error) => void): () => void {
    const onChange = (event: Event): void => {
      if (event.type === 'storage' && 'key' in event && event.key !== signOutKey && event.key !== null)
        return;
      try {
        if (!this.isSignedOut()) return;
      } catch (cause) {
        onStorageError(cause instanceof Error ? cause : new Error('Browser storage is unavailable.'));
        return;
      }
      browserOperation += 1;
      listener();
    };
    this.#events?.addEventListener('storage', onChange);
    this.#events?.addEventListener(signOutEvent, onChange);
    return () => {
      this.#events?.removeEventListener('storage', onChange);
      this.#events?.removeEventListener(signOutEvent, onChange);
    };
  }

  async login(path: string, body: unknown): Promise<BrowserAuthTokenResponse> {
    const operation = ++browserOperation;
    return this.#exclusive(async () => {
      const response = await this.#request(path, body);
      const result = BrowserAuthTokenResponseSchema.parse(response);
      if (operation !== browserOperation) throw new Error('Sign-in was cancelled. Please try again.');
      this.#setSignedOut(false);
      return result;
    });
  }

  async restore(): Promise<BrowserAuthTokenResponse> {
    const operation = browserOperation;
    return this.#exclusive(async () => {
      if (this.isSignedOut()) throw new ApiClientError(401, 'This browser has been signed out.');
      const result = BrowserAuthTokenResponseSchema.parse(
        await this.#request('/api/v1/auth/browser/session', {}),
      );
      if (operation !== browserOperation || this.isSignedOut())
        throw new Error('Session restoration was cancelled.');
      return result;
    });
  }

  async signOut(): Promise<void> {
    browserOperation += 1;
    let storageError: Error | null = null;
    try {
      this.#setSignedOut(true);
    } catch (cause) {
      storageError = cause instanceof Error ? cause : new Error('The browser could not save sign-out.');
    }
    await this.#exclusive(async () => {
      BrowserSessionLogoutResponseSchema.parse(await this.#request('/api/v1/auth/browser/logout', {}));
    });
    if (storageError) throw storageError;
  }

  #setSignedOut(value: boolean): void {
    this.#signedOut = value;
    try {
      if (value) this.#getStorage()?.setItem(signOutKey, '1');
      else this.#getStorage()?.removeItem(signOutKey);
    } catch {
      throw new Error('The browser could not save the sign-out preference. Check browser storage settings.');
    } finally {
      this.#events?.dispatchEvent(new Event(signOutEvent));
    }
  }

  #getStorage(): BrowserStorage | undefined {
    return this.#storage ?? browserRuntime.window?.localStorage;
  }

  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      if (this.#locks) {
        const execution = { entered: false };
        const waiting = new AbortController();
        const waitTimeout = setTimeout(() => {
          waiting.abort();
        }, requestTimeoutMs);
        try {
          return await this.#locks.request(
            'sv-admin-cookie-session',
            { signal: waiting.signal },
            async () => {
              execution.entered = true;
              clearTimeout(waitTimeout);
              return operation();
            },
          );
        } catch (cause) {
          if (
            execution.entered ||
            !(cause instanceof Error) ||
            (cause.name !== 'SecurityError' && cause.name !== 'NotSupportedError')
          )
            throw cause;
        } finally {
          clearTimeout(waitTimeout);
        }
      }
      return operation();
    };
    const next = cookieQueue.then(run, run);
    cookieQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async #request(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, requestTimeoutMs);
    try {
      const response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-sv-app': 'admin@1.0.0',
        },
        signal: controller.signal,
      });
      const raw = await response.text();
      let data: unknown = null;
      try {
        data = JSON.parse(raw) as unknown;
      } catch {
        if (response.ok) throw new Error('The saved session response could not be read. Please try again.');
      }
      if (!response.ok) {
        const parsed = ErrorEnvelopeSchema.safeParse(data);
        throw new ApiClientError(
          response.status,
          parsed.success ? parsed.data.error.message : 'The saved session could not be checked.',
          parsed.success ? parsed.data : null,
        );
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
}
