// Dominio de Autenticación y multi-tenancy (E1-T1).
// Tipos explícitos, sin `any`. Los repositorios son interfaces para poder
// enchufar la persistencia real (Postgres/Prisma) o dobles de test.

export interface Tenant {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
}

export interface User {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  /** Hash scrypt en formato `scrypt$N$r$p$salt$hash`. `null` si el usuario solo usa magic link. */
  readonly passwordHash: string | null;
  readonly createdAt: Date;
}

export interface Session {
  readonly token: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface MagicLink {
  readonly token: string;
  readonly email: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

export interface SignupInput {
  readonly email: string;
  readonly password: string;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export interface PublicUser {
  readonly id: string;
  readonly email: string;
  readonly tenantId: string;
}

export interface AuthResult {
  readonly user: PublicUser;
  readonly session: {
    readonly token: string;
    readonly expiresAt: Date;
  };
}

// --- Puertos (dependencias inyectables) -------------------------------------

export interface TenantRepository {
  create(tenant: Tenant): Promise<Tenant>;
}

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  create(user: User): Promise<User>;
}

export interface SessionRepository {
  create(session: Session): Promise<Session>;
  findByToken(token: string): Promise<Session | null>;
  delete(token: string): Promise<void>;
}

export interface MagicLinkRepository {
  create(link: MagicLink): Promise<MagicLink>;
  findByToken(token: string): Promise<MagicLink | null>;
  markConsumed(token: string, consumedAt: Date): Promise<void>;
}

export interface EmailSender {
  sendMagicLink(email: string, url: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface AuthConfig {
  /** Base pública para construir el magic link, ej: https://app.crm.dev */
  readonly appBaseUrl: string;
  /** TTL de sesión en milisegundos. */
  readonly sessionTtlMs: number;
  /** TTL del magic link en milisegundos. */
  readonly magicLinkTtlMs: number;
}

// --- Errores de dominio ------------------------------------------------------

export type AuthErrorCode =
  | 'INVALID_EMAIL'
  | 'WEAK_PASSWORD'
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED';

export class AuthError extends Error {
  public readonly code: AuthErrorCode;
  public readonly httpStatus: number;

  constructor(code: AuthErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.httpStatus = httpStatus;
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}
