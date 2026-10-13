import { AuthTokenResponseSchema, ErrorEnvelopeSchema, RefreshRequestSchema } from '@sv/contracts';
import type { ErrorEnvelope } from '@sv/contracts';
import type { z } from 'zod';

export interface ApiTokens {
  accessExpiresAt: string;
  accessToken: string;
  refreshToken: string;
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
  onSignOut?: () => Promise<void> | void;
  storage: TokenStorage;
}

export interface RequestOptions<TSchema extends z.ZodType> {
  auth?: boolean;
  body?: unknown;
  headers?: Headers | Record<string, string>;
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
  schema: TSchema;
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
  #refreshInFlight: Promise<ApiTokens> | null = null;

  constructor(options: ApiClientOptions) {
    this.#appVersion = options.appVersion;
    this.#baseUrl = options.baseUrl.replace(/\/$/, '');
    this.#deviceId = options.deviceId;
    this.#fetch = options.fetch ?? fetch;
    this.#onSignOut = options.onSignOut;
    this.#storage = options.storage;
  }

  async request<TSchema extends z.ZodType>(path: string, options: RequestOptions<TSchema>): Promise<z.infer<TSchema>> {
    return this.#request(path, options, true);
  }

  async setTokens(tokens: ApiTokens): Promise<void> {
    await this.#storage.set(tokens);
  }

  async signOut(): Promise<void> {
    await this.#storage.clear();
    await this.#onSignOut?.();
  }

  async #request<TSchema extends z.ZodType>(path: string, options: RequestOptions<TSchema>, allowRefresh: boolean): Promise<z.infer<TSchema>> {
    const response = await this.#send(path, options);
    if (response.status === 401 && options.auth !== false && allowRefresh) {
      try {
        await this.#refresh();
      } catch {
        await this.signOut();
        throw await this.#errorFromResponse(response);
      }
      const retry = await this.#send(path, options);
      if (retry.status === 401) {
        await this.signOut();
        throw await this.#errorFromResponse(retry);
      }
      return this.#parse(retry, options.schema);
    }
    return this.#parse(response, options.schema);
  }

  async #send<TSchema extends z.ZodType>(path: string, options: RequestOptions<TSchema>): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set('accept', 'application/json');
    headers.set('x-sv-app', this.#appVersion);
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    const tokens = await this.#storage.get();
    if (options.auth !== false && tokens) headers.set('authorization', `Bearer ${tokens.accessToken}`);
    const init: RequestInit = {
      headers,
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    return this.#fetch(`${this.#baseUrl}${path.startsWith('/') ? path : `/${path}`}`, init);
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

  async #refresh(): Promise<ApiTokens> {
    const existing = this.#refreshInFlight;
    if (existing) return existing;
    const refreshPromise = this.#refreshNow().finally(() => {
      this.#refreshInFlight = null;
    });
    this.#refreshInFlight = refreshPromise;
    return refreshPromise;
  }

  async #refreshNow(): Promise<ApiTokens> {
    const tokens = await this.#storage.get();
    if (!tokens) throw new ApiClientError(401, 'No refresh token available.');
    const body = RefreshRequestSchema.parse({ deviceId: this.#deviceId, refreshToken: tokens.refreshToken });
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
    const nextTokens: ApiTokens = {
      accessExpiresAt: data.accessExpiresAt,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    };
    await this.#storage.set(nextTokens);
    return nextTokens;
  }
}
