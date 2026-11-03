import { AuthTokenResponseSchema, ErrorEnvelopeSchema, RefreshRequestSchema } from '@sv/contracts';
import type { ErrorEnvelope } from '@sv/contracts';
import type { z } from 'zod';

export interface ApiTokens {
  accessExpiresAt: string;
  accessToken: string;
  refreshToken?: string;
  refreshRequestId?: string;
}

export interface TokenStorage {
  clear(): Promise<void>;
  get(): Promise<ApiTokens | null>;
  set(tokens: ApiTokens): Promise<void>;
}

export interface ApiClientOptions {
  appVersion: string;
  baseUrl: string;
  deviceId: string;
  fetch?: typeof fetch;
  refreshTokens?: () => Promise<ApiTokens>;
  createRefreshRequestId?: () => string;
  onSignOut?: () => Promise<void> | void;
  storage: TokenStorage;
}

export interface RequestOptions<TSchema extends z.ZodType> {
  auth?: boolean;
  body?: unknown;
  headers?: Headers | Record<string, string>;
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
  signal?: AbortSignal;
  schema: TSchema;
}

function assertRequestActive(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const error = new Error('The request was canceled.');
  error.name = 'AbortError';
  throw error;
}

export class ApiClientError extends Error {
  readonly envelope: ErrorEnvelope | null;
  readonly status: number;

  constructor(status: number, message: string, envelope: ErrorEnvelope | null = null) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.envelope = envelope;
  }
}

export class MemoryTokenStorage implements TokenStorage {
  #tokens: ApiTokens | null = null;

  clear(): Promise<void> {
    this.#tokens = null;
    return Promise.resolve();
  }

  get(): Promise<ApiTokens | null> {
    return Promise.resolve(this.#tokens);
  }

  set(tokens: ApiTokens): Promise<void> {
    this.#tokens = tokens;
    return Promise.resolve();
  }
}

export class SpeedyVanApiClient {
  readonly #appVersion: string;
  readonly #baseUrl: string;
  readonly #deviceId: string;
  readonly #fetch: typeof fetch;
  readonly #onSignOut: (() => Promise<void> | void) | undefined;
  readonly #storage: TokenStorage;
  readonly #refreshTokens: (() => Promise<ApiTokens>) | undefined;
  readonly #createRefreshRequestId: (() => string) | undefined;
  #refreshInFlight: { epoch: number; promise: Promise<ApiTokens> } | null = null;
  #storageWrites: Promise<void> = Promise.resolve();
  #sessionEpoch = 0;
  #signedOut = false;

  constructor(options: ApiClientOptions) {
    this.#appVersion = options.appVersion;
    this.#baseUrl = options.baseUrl.replace(/\/$/, '');
    this.#deviceId = options.deviceId;
    this.#fetch = options.fetch ?? fetch;
    this.#onSignOut = options.onSignOut;
    this.#storage = options.storage;
    this.#refreshTokens = options.refreshTokens;
    this.#createRefreshRequestId = options.createRefreshRequestId;
  }

  async request<TSchema extends z.ZodType>(
    path: string,
    options: RequestOptions<TSchema>,
  ): Promise<z.infer<TSchema>> {
    return this.#request(path, options, true);
  }

  async setTokens(tokens: ApiTokens): Promise<void> {
    const epoch = ++this.#sessionEpoch;
    this.#signedOut = false;
    await this.#mutateStorage(async () => {
      if (epoch === this.#sessionEpoch && !this.#signedOut) await this.#storage.set(tokens);
    });
  }

  async signOut(): Promise<void> {
    const epoch = ++this.#sessionEpoch;
    this.#signedOut = true;
    await this.#mutateStorage(() => this.#storage.clear());
    if (epoch === this.#sessionEpoch) await this.#onSignOut?.();
  }

  async #request<TSchema extends z.ZodType>(
    path: string,
    options: RequestOptions<TSchema>,
    allowRefresh: boolean,
  ): Promise<z.infer<TSchema>> {
    assertRequestActive(options.signal);
    const sent = await this.#send(path, options);
    assertRequestActive(options.signal);
    if (sent.response.status === 401 && options.auth !== false && allowRefresh) {
      this.#assertEpoch(sent.epoch);
      const latest = await this.#readTokens();
      this.#assertEpoch(sent.epoch);
      // A delayed response for an older access token must reuse the completed rotation.
      if (this.#sameTokens(latest, sent.tokens)) {
        try {
          await this.#refresh(sent.epoch, sent.tokens);
        } catch (error) {
          if (
            error instanceof ApiClientError &&
            error.status === 401 &&
            error.envelope?.error.code === 'UNAUTHORIZED'
          ) {
            await this.#invalidateIfCurrent(sent.epoch, sent.tokens);
          }
          // Network, timeout, service, rate-limit and response-schema errors are retryable;
          // none proves the persisted session has been revoked.
          throw error;
        }
      }
      const retry = await this.#send(path, options, sent.epoch);
      assertRequestActive(options.signal);
      if (retry.response.status === 401) {
        const error = await this.#errorFromResponse(retry.response);
        if (error.envelope?.error.code === 'UNAUTHORIZED') {
          await this.#invalidateIfCurrent(retry.epoch, retry.tokens);
        }
        throw error;
      }
      return this.#parse(retry.response, options.schema);
    }
    return this.#parse(sent.response, options.schema);
  }

  async #send<TSchema extends z.ZodType>(
    path: string,
    options: RequestOptions<TSchema>,
    expectedEpoch = this.#sessionEpoch,
  ): Promise<{ response: Response; tokens: ApiTokens | null; epoch: number }> {
    assertRequestActive(options.signal);
    if (options.auth !== false) this.#assertEpoch(expectedEpoch, false);
    const headers = new Headers(options.headers);
    headers.set('accept', 'application/json');
    headers.set('x-sv-app', this.#appVersion);
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    const tokens = options.auth === false ? null : await this.#readTokens();
    if (options.auth !== false) this.#assertEpoch(expectedEpoch, false);
    if (options.auth !== false && tokens) headers.set('authorization', `Bearer ${tokens.accessToken}`);
    const init: RequestInit = {
      headers,
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    if (options.signal) init.signal = options.signal;
    assertRequestActive(options.signal);
    const response = await this.#fetch(`${this.#baseUrl}${path.startsWith('/') ? path : `/${path}`}`, init);
    return { response, tokens, epoch: expectedEpoch };
  }

  async #parse<TSchema extends z.ZodType>(response: Response, schema: TSchema): Promise<z.infer<TSchema>> {
    if (!response.ok) throw await this.#errorFromResponse(response);
    const data = await response.json();
    return schema.parse(data);
  }

  async #errorFromResponse(response: Response): Promise<ApiClientError> {
    const parsed = await response
      .clone()
      .json()
      .then((data: unknown) => ErrorEnvelopeSchema.safeParse(data))
      .catch(() => null);
    if (parsed?.success) {
      return new ApiClientError(response.status, parsed.data.error.message, parsed.data);
    }
    return new ApiClientError(response.status, `Request failed with ${String(response.status)}`);
  }

  async #refresh(epoch: number, sentTokens: ApiTokens | null): Promise<ApiTokens> {
    const existing = this.#refreshInFlight;
    if (existing?.epoch === epoch) return existing.promise;
    const refreshPromise = this.#refreshNow(epoch, sentTokens).finally(() => {
      if (this.#refreshInFlight?.promise === refreshPromise) this.#refreshInFlight = null;
    });
    this.#refreshInFlight = { epoch, promise: refreshPromise };
    return refreshPromise;
  }

  async #refreshNow(epoch: number, sentTokens: ApiTokens | null): Promise<ApiTokens> {
    const tokens = await this.#readTokens();
    this.#assertEpoch(epoch);
    if (!tokens) throw new ApiClientError(401, 'No refresh token available.');
    if (!this.#sameTokens(tokens, sentTokens)) return tokens;
    let nextTokens: ApiTokens;
    if (this.#refreshTokens) {
      const next = await this.#refreshTokens();
      const schema = AuthTokenResponseSchema.pick({
        accessToken: true,
        accessExpiresAt: true,
        refreshToken: true,
      }).partial({ refreshToken: true });
      const parsed = schema.parse({
        accessToken: next.accessToken,
        accessExpiresAt: next.accessExpiresAt,
        ...(next.refreshToken ? { refreshToken: next.refreshToken } : {}),
      });
      nextTokens = {
        accessToken: parsed.accessToken,
        accessExpiresAt: parsed.accessExpiresAt,
        ...(parsed.refreshToken ? { refreshToken: parsed.refreshToken } : {}),
      };
    } else {
      if (!tokens.refreshToken) throw new ApiClientError(401, 'No refresh token available.');
      const pending = await this.#mutateStorage(async () => {
        this.#assertEpoch(epoch);
        const current = await this.#storage.get();
        this.#assertEpoch(epoch);
        if (!current || !this.#sameTokens(current, tokens)) return current;
        const requestId = current.refreshRequestId ?? this.#newRefreshRequestId();
        RefreshRequestSchema.parse({
          deviceId: this.#deviceId,
          refreshToken: current.refreshToken,
          requestId,
        });
        const saved = { ...current, refreshRequestId: requestId };
        await this.#storage.set(saved);
        return saved;
      });
      this.#assertEpoch(epoch);
      if (!pending) throw new ApiClientError(401, 'This sign-in session changed. Please try again.');
      if (!this.#sameTokens(pending, tokens)) return pending;
      const body = RefreshRequestSchema.parse({
        deviceId: this.#deviceId,
        refreshToken: pending.refreshToken,
        requestId: pending.refreshRequestId,
      });
      const response = await this.#fetch(`${this.#baseUrl}/api/v1/auth/refresh`, {
        body: JSON.stringify(body),
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-sv-app': this.#appVersion,
        },
        method: 'POST',
      });
      if (!response.ok) throw await this.#errorFromResponse(response);
      const data = AuthTokenResponseSchema.parse(await response.json());
      nextTokens = {
        accessExpiresAt: data.accessExpiresAt,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      };
    }
    await this.#mutateStorage(async () => {
      this.#assertEpoch(epoch);
      const current = await this.#storage.get();
      this.#assertEpoch(epoch);
      if (this.#sameTokens(current, tokens)) await this.#storage.set(nextTokens);
    });
    this.#assertEpoch(epoch);
    const current = await this.#readTokens();
    this.#assertEpoch(epoch);
    if (!current) throw new ApiClientError(401, 'This sign-in session changed. Please try again.');
    return current;
  }

  #sameTokens(left: ApiTokens | null, right: ApiTokens | null): boolean {
    return left?.accessToken === right?.accessToken && left?.refreshToken === right?.refreshToken;
  }

  #newRefreshRequestId(): string {
    if (this.#createRefreshRequestId) return this.#createRefreshRequestId();
    const runtime = globalThis as { crypto?: { randomUUID?: () => string } };
    if (typeof runtime.crypto?.randomUUID === 'function') return runtime.crypto.randomUUID();
    throw new ApiClientError(0, 'Secure session recovery is unavailable. Please try again.');
  }

  #assertEpoch(epoch: number, requireSignedIn = true): void {
    if (epoch !== this.#sessionEpoch || (requireSignedIn && this.#signedOut)) {
      throw new ApiClientError(401, 'This sign-in session changed. Please try again.');
    }
  }

  async #readTokens(): Promise<ApiTokens | null> {
    await this.#storageWrites;
    return this.#signedOut ? null : this.#storage.get();
  }

  #mutateStorage<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#storageWrites.then(operation, operation);
    this.#storageWrites = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async #invalidateIfCurrent(epoch: number, rejected: ApiTokens | null): Promise<void> {
    const invalidatedEpoch = await this.#mutateStorage(async (): Promise<number | null> => {
      if (epoch !== this.#sessionEpoch || this.#signedOut) return null;
      const current = await this.#storage.get();
      if (epoch !== this.#sessionEpoch || !this.#sameTokens(current, rejected)) return null;
      const nextEpoch = ++this.#sessionEpoch;
      this.#signedOut = true;
      await this.#storage.clear();
      return nextEpoch;
    });
    if (invalidatedEpoch !== null && invalidatedEpoch === this.#sessionEpoch) await this.#onSignOut?.();
  }
}
