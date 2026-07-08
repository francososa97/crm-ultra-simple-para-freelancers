import { randomBytes } from 'crypto';
import type { User } from '../../shared/types';

/**
 * Servicio de autenticación con Google OAuth 2.0 (Authorization Code flow).
 *
 * Reutiliza el tipo `User` de src/shared/types. El proveedor queda registrado
 * como `provider = 'google'` al crear/vincular la cuenta, cumpliendo el AC de
 * la task E1-T2.
 */

/** Configuración necesaria para operar contra el endpoint OAuth de Google. */
export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Debe coincidir EXACTAMENTE con la URI registrada en Google Cloud Console. */
  redirectUri: string;
  /** Scopes solicitados. Por defecto: identidad básica + email. */
  scopes?: string[];
}

/** Respuesta del token endpoint de Google (campos relevantes). */
interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token: string;
  refresh_token?: string;
}

/** Perfil normalizado devuelto por el userinfo endpoint de Google. */
export interface GoogleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
}

/**
 * Puerto de persistencia. La implementación concreta (Prisma/Drizzle/etc.) vive
 * fuera de esta feature; aquí sólo dependemos de la interfaz para mantener el
 * servicio testeable y desacoplado.
 */
export interface UserRepository {
  findByProviderId(provider: 'google', providerId: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: {
    email: string;
    name: string;
    provider: 'google';
    providerId: string;
    avatarUrl?: string;
  }): Promise<User>;
  linkProvider(
    userId: string,
    data: { provider: 'google'; providerId: string; avatarUrl?: string },
  ): Promise<User>;
}

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const DEFAULT_SCOPES = ['openid', 'email', 'profile'];

export class GoogleOAuthError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'GoogleOAuthError';
  }
}

export class GoogleOAuthService {
  private readonly config: Required<GoogleOAuthConfig>;

  constructor(
    config: GoogleOAuthConfig,
    private readonly users: UserRepository,
  ) {
    if (!config.clientId || !config.clientSecret || !config.redirectUri) {
      throw new GoogleOAuthError(
        'GoogleOAuthService requiere clientId, clientSecret y redirectUri',
      );
    }
    this.config = {
      ...config,
      scopes: config.scopes ?? DEFAULT_SCOPES,
    };
  }

  /** Genera un token opaco anti-CSRF para el parámetro `state`. */
  generateState(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Construye la URL de consentimiento de Google a la que redirigir cuando el
   * usuario hace click en 'Continuar con Google'.
   */
  buildAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state,
      access_type: 'offline',
      prompt: 'consent',
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Punto de entrada del callback: intercambia el `code` por un perfil y
   * crea/vincula al usuario. Devuelve el `User` autenticado con provider=google.
   */
  async authenticate(code: string): Promise<User> {
    const tokens = await this.exchangeCodeForTokens(code);
    const profile = await this.fetchProfile(tokens.access_token);

    if (!profile.email_verified) {
      throw new GoogleOAuthError('El email de Google no está verificado');
    }
    return this.upsertUser(profile);
  }

  private async exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams({
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      grant_type: 'authorization_code',
    });

    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new GoogleOAuthError(
        `Fallo al intercambiar el authorization code (HTTP ${res.status})`,
        detail,
      );
    }
    return (await res.json()) as GoogleTokenResponse;
  }

  private async fetchProfile(accessToken: string): Promise<GoogleProfile> {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new GoogleOAuthError(
        `Fallo al obtener el perfil de Google (HTTP ${res.status})`,
        detail,
      );
    }
    return (await res.json()) as GoogleProfile;
  }

  /**
   * Estrategia de resolución de identidad:
   * 1. Si ya existe una cuenta vinculada por (provider, sub) → login.
   * 2. Si existe un usuario con ese email → se vincula el proveedor google.
   * 3. En otro caso → se crea un usuario nuevo con provider=google.
   */
  private async upsertUser(profile: GoogleProfile): Promise<User> {
    const existingByProvider = await this.users.findByProviderId('google', profile.sub);
    if (existingByProvider) {
      return existingByProvider;
    }

    const existingByEmail = await this.users.findByEmail(profile.email);
    if (existingByEmail) {
      return this.users.linkProvider(existingByEmail.id, {
        provider: 'google',
        providerId: profile.sub,
        avatarUrl: profile.picture,
      });
    }

    return this.users.create({
      email: profile.email,
      name: profile.name,
      provider: 'google',
      providerId: profile.sub,
      avatarUrl: profile.picture,
    });
  }
}
