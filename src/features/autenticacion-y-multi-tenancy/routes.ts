// Rutas HTTP de Autenticación (E1-T1) para Express.
// Cablea el AuthService a los endpoints del Acceptance Criteria:
//  - POST /auth/signup            -> 201 + usuario creado + cookie de sesión
//  - POST /auth/login             -> 200 + cookie de sesión
//  - POST /auth/magic-link        -> 202 (envía email, respuesta genérica)
//  - GET  /auth/magic-link/verify -> setea sesión y redirige a /dashboard
//
// Se tipa un contrato mínimo de Express para no acoplar el archivo a @types/express
// si aún no está instalado; en runtime son objetos req/res estándar de Express.

import { AuthError } from './types';
import { AuthService } from './service';

const SESSION_COOKIE = 'crm_session';

interface HttpRequest {
  body: unknown;
  query: Record<string, unknown>;
}

interface HttpResponse {
  status(code: number): HttpResponse;
  json(payload: unknown): HttpResponse;
  cookie(name: string, value: string, options: CookieOptions): HttpResponse;
  redirect(url: string): void;
}

interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  expires: Date;
  path: string;
}

type RouteHandler = (req: HttpRequest, res: HttpResponse) => Promise<void>;

interface Router {
  post(path: string, handler: RouteHandler): void;
  get(path: string, handler: RouteHandler): void;
}

interface RouterFactory {
  (): Router;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sessionCookieOptions(expires: Date, secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    expires,
    path: '/',
  };
}

function handleError(res: HttpResponse, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.httpStatus).json({ error: err.code, message: err.message });
    return;
  }
  res.status(500).json({ error: 'INTERNAL', message: 'Error interno' });
}

export interface AuthRoutesOptions {
  /** true en producción (HTTPS) para marcar la cookie como `secure`. */
  readonly secureCookies: boolean;
  /** Ruta de destino tras autenticar por magic link. */
  readonly dashboardPath?: string;
}

/**
 * Construye el router de autenticación. `createRouter` normalmente es
 * `express.Router`. Se inyecta para mantener el módulo testeable y desacoplado.
 */
export function createAuthRouter(
  service: AuthService,
  createRouter: RouterFactory,
  options: AuthRoutesOptions,
): Router {
  const router = createRouter();
  const dashboard = options.dashboardPath ?? '/dashboard';

  router.post('/auth/signup', async (req, res) => {
    try {
      const body = asRecord(req.body);
      const result = await service.signup({
        email: asString(body.email),
        password: asString(body.password),
      });
      res
        .cookie(
          SESSION_COOKIE,
          result.session.token,
          sessionCookieOptions(result.session.expiresAt, options.secureCookies),
        )
        .status(201)
        .json({ user: result.user });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/auth/login', async (req, res) => {
    try {
      const body = asRecord(req.body);
      const result = await service.login({
        email: asString(body.email),
        password: asString(body.password),
      });
      res
        .cookie(
          SESSION_COOKIE,
          result.session.token,
          sessionCookieOptions(result.session.expiresAt, options.secureCookies),
        )
        .status(200)
        .json({ user: result.user });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/auth/magic-link', async (req, res) => {
    try {
      const body = asRecord(req.body);
      await service.requestMagicLink(asString(body.email));
      // Respuesta genérica: no revela si el email existe.
      res.status(202).json({ message: 'Si el email es válido, enviamos un enlace de acceso' });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/auth/magic-link/verify', async (req, res) => {
    try {
      const token = asString(asRecord(req.query).token);
      const result = await service.verifyMagicLink(token);
      res.cookie(
        SESSION_COOKIE,
        result.session.token,
        sessionCookieOptions(result.session.expiresAt, options.secureCookies),
      );
      res.redirect(dashboard);
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}

export const AUTH_SESSION_COOKIE = SESSION_COOKIE;
