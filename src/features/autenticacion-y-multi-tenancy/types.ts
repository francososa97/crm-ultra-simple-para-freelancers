// Tipos del dominio de autenticación social (Google OAuth).
// Se definen aquí de forma explícita porque el módulo es autocontenido;
// si src/shared/types/index.ts expone User/Tenant, reexportar desde ahí.

/** Proveedor de identidad social soportado. */
export type AuthProvider = 'google';

/** Configuración necesaria para operar el flujo OAuth de Google. */
export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  /** URI absoluta registrada en Google Cloud Console (callback). */
  readonly redirectUri: string;
  /** Scopes solicitados. Por defecto: openid, email, profile. */
  readonly scopes: readonly string[];
}

/** Perfil normalizado devuelto por el endpoint userinfo de Google. */
export interface GoogleProfile {
  readonly providerAccountId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

/** Usuario persistido/vinculado tras el login social. */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
  readonly provider: AuthProvider;
  readonly providerAccountId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Datos de entrada para crear/vincular un usuario a partir de un perfil. */
export interface UpsertUserInput {
  readonly email: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
  readonly provider: AuthProvider;
  readonly providerAccountId: string;
}

/**
 * Puerto de persistencia. La feature no conoce la DB concreta;
 * la implementación (Prisma/Drizzle/etc.) se inyecta desde infraestructura.
 */
export interface UserRepository {
  findByProviderAccount(
    provider: AuthProvider,
    providerAccountId: string,
  ): Promise<AuthUser | null>;
  findByEmail(email: string): Promise<AuthUser | null>;
  /** Crea el usuario o vincula el proveedor a uno existente (idempotente). */
  upsertFromProvider(input: UpsertUserInput): Promise<AuthUser>;
}

/** Emisión de sesión (JWT/cookie). Se inyecta desde infraestructura. */
export interface SessionIssuer {
  issue(user: AuthUser): Promise<string>;
}

/** Almacén del `state` anti-CSRF (memoria/redis/cookie firmada). */
export interface OAuthStateStore {
  save(state: string): Promise<void>;
  /** Devuelve true y consume el state si era válido; false si no existe. */
  consume(state: string): Promise<boolean>;
}

/** Resultado de resolver el callback OAuth. */
export interface LoginResult {
  readonly user: AuthUser;
  readonly sessionToken: string;
  /** Ruta a la que redirigir tras autenticar. */
  readonly redirectTo: string;
}

/** Respuesta cruda del endpoint de token de Google. */
export interface GoogleTokenResponse {
  readonly access_token: string;
  readonly expires_in: number;
  readonly scope: string;
  readonly token_type: string;
  readonly id_token?: string;
}

/** Error tipado del flujo OAuth. */
export class OAuthError extends Error {
  public readonly code: OAuthErrorCode;
  constructor(code: OAuthErrorCode, message: string) {
    super(message);
    this.name = 'OAuthError';
    this.code = code;
  }
}

export type OAuthErrorCode =
  | 'invalid_state'
  | 'token_exchange_failed'
  | 'userinfo_failed'
  | 'email_not_verified'
  | 'missing_code';
