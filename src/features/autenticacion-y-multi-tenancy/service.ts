// Servicio de Autenticación y multi-tenancy (E1-T1).
// Encapsula la lógica: signup con password, login, y flujo magic link.
// Cada signup crea un Tenant propio (aislamiento multi-tenant desde el registro).

import {
  randomUUID,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import {
  AuthConfig,
  AuthError,
  AuthResult,
  Clock,
  EmailSender,
  LoginInput,
  MagicLink,
  MagicLinkRepository,
  PublicUser,
  Session,
  SessionRepository,
  SignupInput,
  Tenant,
  TenantRepository,
  User,
  UserRepository,
} from './types';

const scrypt = promisify(scryptCb);

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const MIN_PASSWORD_LENGTH = 8;
// RFC 5322 simplificado: suficiente para validar entrada de usuario.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AuthServiceDeps {
  readonly tenants: TenantRepository;
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly magicLinks: MagicLinkRepository;
  readonly email: EmailSender;
  readonly clock: Clock;
  readonly config: AuthConfig;
}

export class AuthService {
  private readonly deps: AuthServiceDeps;

  constructor(deps: AuthServiceDeps) {
    this.deps = deps;
  }

  /** POST /auth/signup — crea tenant + usuario y abre sesión. Devuelve datos para 201. */
  public async signup(input: SignupInput): Promise<AuthResult> {
    const email = this.normalizeEmail(input.email);
    this.assertValidEmail(email);
    this.assertStrongPassword(input.password);

    const existing = await this.deps.users.findByEmail(email);
    if (existing !== null) {
      throw new AuthError('EMAIL_TAKEN', 'El email ya está registrado', 409);
    }

    const now = this.deps.clock.now();
    const tenant: Tenant = {
      id: randomUUID(),
      name: this.defaultTenantName(email),
      createdAt: now,
    };
    await this.deps.tenants.create(tenant);

    const passwordHash = await this.hashPassword(input.password);
    const user: User = {
      id: randomUUID(),
      tenantId: tenant.id,
      email,
      passwordHash,
      createdAt: now,
    };
    await this.deps.users.create(user);

    const session = await this.openSession(user);
    return this.toAuthResult(user, session);
  }

  /** POST /auth/login — valida credenciales y abre sesión. */
  public async login(input: LoginInput): Promise<AuthResult> {
    const email = this.normalizeEmail(input.email);
    const user = await this.deps.users.findByEmail(email);

    // Mensaje genérico + verificación aun sin hash para no filtrar existencia (timing).
    if (user === null || user.passwordHash === null) {
      await this.hashPassword(input.password);
      throw new AuthError('INVALID_CREDENTIALS', 'Email o password inválidos', 401);
    }

    const ok = await this.verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      throw new AuthError('INVALID_CREDENTIALS', 'Email o password inválidos', 401);
    }

    const session = await this.openSession(user);
    return this.toAuthResult(user, session);
  }

  /**
   * POST /auth/magic-link — genera y envía un magic link al email.
   * No revela si el email existe; siempre resuelve igual. El usuario se crea
   * (junto a su tenant) al verificar, si aún no existía.
   */
  public async requestMagicLink(rawEmail: string): Promise<void> {
    const email = this.normalizeEmail(rawEmail);
    this.assertValidEmail(email);

    const now = this.deps.clock.now();
    const token = randomBytes(32).toString('base64url');
    const link: MagicLink = {
      token,
      email,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.deps.config.magicLinkTtlMs),
      consumedAt: null,
    };
    await this.deps.magicLinks.create(link);

    const url = `${this.trimSlash(this.deps.config.appBaseUrl)}/auth/magic-link/verify?token=${encodeURIComponent(token)}`;
    await this.deps.email.sendMagicLink(email, url);
  }

  /**
   * GET /auth/magic-link/verify — consume el token de un solo uso, crea el
   * usuario+tenant si es su primer acceso, y abre sesión. El handler HTTP debe
   * setear la cookie de sesión y redirigir a /dashboard.
   */
  public async verifyMagicLink(token: string): Promise<AuthResult> {
    if (typeof token !== 'string' || token.length === 0) {
      throw new AuthError('INVALID_TOKEN', 'Token inválido', 400);
    }

    const link = await this.deps.magicLinks.findByToken(token);
    if (link === null || link.consumedAt !== null) {
      throw new AuthError('INVALID_TOKEN', 'Token inválido o ya usado', 400);
    }

    const now = this.deps.clock.now();
    if (link.expiresAt.getTime() <= now.getTime()) {
      throw new AuthError('TOKEN_EXPIRED', 'El magic link expiró', 400);
    }

    await this.deps.magicLinks.markConsumed(token, now);

    let user = await this.deps.users.findByEmail(link.email);
    if (user === null) {
      const tenant: Tenant = {
        id: randomUUID(),
        name: this.defaultTenantName(link.email),
        createdAt: now,
      };
      await this.deps.tenants.create(tenant);
      user = await this.deps.users.create({
        id: randomUUID(),
        tenantId: tenant.id,
        email: link.email,
        passwordHash: null,
        createdAt: now,
      });
    }

    const session = await this.openSession(user);
    return this.toAuthResult(user, session);
  }

  /** Resuelve la sesión activa a partir del token de cookie (para middleware de auth). */
  public async resolveSession(token: string): Promise<Session | null> {
    const session = await this.deps.sessions.findByToken(token);
    if (session === null) {
      return null;
    }
    if (session.expiresAt.getTime() <= this.deps.clock.now().getTime()) {
      await this.deps.sessions.delete(token);
      return null;
    }
    return session;
  }

  public async logout(token: string): Promise<void> {
    await this.deps.sessions.delete(token);
  }

  // --- Helpers internos ------------------------------------------------------

  private async openSession(user: User): Promise<Session> {
    const now = this.deps.clock.now();
    const session: Session = {
      token: randomBytes(32).toString('base64url'),
      userId: user.id,
      tenantId: user.tenantId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.deps.config.sessionTtlMs),
    };
    return this.deps.sessions.create(session);
  }

  private toAuthResult(user: User, session: Session): AuthResult {
    const publicUser: PublicUser = {
      id: user.id,
      email: user.email,
      tenantId: user.tenantId,
    };
    return {
      user: publicUser,
      session: { token: session.token, expiresAt: session.expiresAt },
    };
  }

  private normalizeEmail(email: string): string {
    return String(email ?? '').trim().toLowerCase();
  }

  private assertValidEmail(email: string): void {
    if (!EMAIL_RE.test(email)) {
      throw new AuthError('INVALID_EMAIL', 'Email inválido', 400);
    }
  }

  private assertStrongPassword(password: string): void {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(
        'WEAK_PASSWORD',
        `El password debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
        400,
      );
    }
  }

  private defaultTenantName(email: string): string {
    const local = email.split('@')[0] ?? 'workspace';
    return `${local}'s workspace`;
  }

  private trimSlash(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = (await scrypt(password, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    })) as Buffer;
    return [
      'scrypt',
      String(SCRYPT_N),
      String(SCRYPT_R),
      String(SCRYPT_P),
      salt.toString('base64'),
      derived.toString('base64'),
    ].join('$');
  }

  private async verifyPassword(password: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') {
      return false;
    }
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
      return false;
    }
    const derived = (await scrypt(password, salt, expected.length, {
      N: n,
      r,
      p,
    })) as Buffer;
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }
}
