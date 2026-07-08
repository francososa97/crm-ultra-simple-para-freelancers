// Servicio de login social con Google OAuth 2.0 (Authorization Code flow).
// Autocontenido y agnóstico de framework: recibe sus dependencias por
// inyección (repositorio de usuarios, emisor de sesión, store de state).

import { randomUUID } from 'node:crypto';
import {
  AuthProvider,
  GoogleOAuthConfig,
  GoogleProfile,
  GoogleTokenResponse,
  LoginResult,
  OAuthError,
  OAuthStateStore,
  SessionIssuer,
  UserRepository,
} from './types';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

const PROVIDER: AuthProvider = 'google';
const DEFAULT_SCOPES: readonly string[] = ['openid', 'email', 'profile'];
const DEFAULT_REDIRECT_TO = '/dashboard';

/** Dependencias inyectables del servicio. */
export interface GoogleOAuthDeps {
  readonly config: GoogleOAuthConfig;
  readonly users: UserRepository;
  readonly sessions: SessionIssuer;
  readonly stateStore: OAuthStateStore;
  /** Inyectable para tests; por defecto usa fetch global. */
  readonly fetchFn?: typeof fetch;
}

/** Forma cruda esperada del endpoint userinfo (OpenID Connect). */
interface GoogleUserInfoRaw {
  readonly sub: string;
  readonly email: string;
  readonly email_verified?: boolean;
  readonly name?: string;
  readonly picture?: string;
}

export class GoogleOAuthService {
  private readonly config: GoogleOAuthConfig;
  private readonly users: UserRepository;
  private readonly sessions: SessionIssuer;
  private readonly stateStore: OAuthStateStore;
  private readonly fetchFn: typeof fetch;

  constructor(deps: GoogleOAuthDeps) {
    this.config = {
      ...deps.config,
      scopes: deps.config.scopes.length > 0 ? deps.config.scopes : DEFAULT_SCOPES,
    };
    this.users = deps.users;
    this.sessions = deps.sessions;
    this.stateStore = deps.stateStore;
    this.fetchFn = deps.fetchFn ?? fetch;
  }

  /**
   * Paso 1: construye la URL de consentimiento a la que redirigir cuando el
   * usuario hace click en 'Continuar con Google'. Genera y persiste un
   * `state` anti-CSRF.
   */
  public async createAuthorizationUrl(): Promise<string> {
    const state: string = randomUUID();
    await this.stateStore.save(state);

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state,
      access_type: 'offline',
      prompt: 'select_account',
      include_granted_scopes: 'true',
    });

    return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
  }

  /**
   * Paso 2: resuelve el callback OAuth. Valida el `state`, intercambia el
   * `code` por un access token, obtiene el perfil, crea/vincula el usuario
   * con provider=google y emite la sesión.
   */
  public async handleCallback(
    code: string | null,
    state: string | null,
    redirectTo: string = DEFAULT_REDIRECT_TO,
  ): Promise<LoginResult> {
    if (code === null || code.length === 0) {
      throw new OAuthError('missing_code', 'Falta el parámetro code en el callback.');
    }
    if (state === null || !(await this.stateStore.consume(state))) {
      throw new OAuthError('invalid_state', 'El state OAuth es inválido o expiró.');
    }

    const token: GoogleTokenResponse = await this.exchangeCode(code);
    const profile: GoogleProfile = await this.fetchProfile(token.access_token);

    if (!profile.emailVerified) {
      throw new OAuthError(
        'email_not_verified',
        'La cuenta de Google no tiene el email verificado.',
      );
    }

    const user = await this.users.upsertFromProvider({
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      provider: PROVIDER,
      providerAccountId: profile.providerAccountId,
    });

    const sessionToken: string = await this.sessions.issue(user);

    return { user, sessionToken, redirectTo: this.safeRedirect(redirectTo) };
  }

  /** Intercambia el authorization code por un access token. */
  private async exchangeCode(code: string): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams({
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      grant_type: 'authorization_code',
    });

    const response = await this.fetchFn(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const detail: string = await response.text().catch(() => '');
      throw new OAuthError(
        'token_exchange_failed',
        `Fallo al intercambiar el code (${response.status}): ${detail}`,
      );
    }

    return (await response.json()) as GoogleTokenResponse;
  }

  /** Obtiene y normaliza el perfil del usuario desde el endpoint userinfo. */
  private async fetchProfile(accessToken: string): Promise<GoogleProfile> {
    const response = await this.fetchFn(GOOGLE_USERINFO_ENDPOINT, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const detail: string = await response.text().catch(() => '');
      throw new OAuthError(
        'userinfo_failed',
        `Fallo al obtener el perfil (${response.status}): ${detail}`,
      );
    }

    const raw = (await response.json()) as GoogleUserInfoRaw;

    return {
      providerAccountId: raw.sub,
      email: raw.email,
      emailVerified: raw.email_verified === true,
      name: raw.name ?? null,
      avatarUrl: raw.picture ?? null,
    };
  }

  /** Evita open-redirects: solo se permiten rutas internas absolutas. */
  private safeRedirect(target: string): string {
    if (target.startsWith('/') && !target.startsWith('//')) {
      return target;
    }
    return DEFAULT_REDIRECT_TO;
  }
}
