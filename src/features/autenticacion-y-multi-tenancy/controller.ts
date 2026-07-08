// Handlers HTTP para el login social con Google, agnósticos del framework.
// Trabajan sobre pequeñas abstracciones (HttpRequest/HttpResponder) para
// poder montarse sobre Express, Fastify o route handlers de Next/Node.

import { GoogleOAuthService } from './service';
import { OAuthError } from './types';

/** Petición mínima que necesitan los handlers. */
export interface HttpRequest {
  /** Query params ya parseados (p. ej. req.query en Express). */
  readonly query: Readonly<Record<string, string | undefined>>;
}

/** Respondedor mínimo: redirección y cookie de sesión. */
export interface HttpResponder {
  redirect(location: string): void;
  setSessionCookie(token: string): void;
  fail(status: number, message: string): void;
}

/** Ruta a la que enviar al usuario cuando el login falla. */
const LOGIN_ERROR_PATH = '/login?error=oauth';

export class GoogleAuthController {
  private readonly service: GoogleOAuthService;

  constructor(service: GoogleOAuthService) {
    this.service = service;
  }

  /**
   * GET /auth/google — dispara el flujo: redirige a la pantalla de
   * consentimiento de Google ('Continuar con Google').
   */
  public async start(_req: HttpRequest, res: HttpResponder): Promise<void> {
    const url: string = await this.service.createAuthorizationUrl();
    res.redirect(url);
  }

  /**
   * GET /auth/google/callback — Google redirige aquí con code+state.
   * Autentica, setea la cookie de sesión y redirige a /dashboard.
   */
  public async callback(req: HttpRequest, res: HttpResponder): Promise<void> {
    const code: string | null = req.query.code ?? null;
    const state: string | null = req.query.state ?? null;

    try {
      const result = await this.service.handleCallback(code, state);
      res.setSessionCookie(result.sessionToken);
      res.redirect(result.redirectTo);
    } catch (error: unknown) {
      if (error instanceof OAuthError) {
        res.redirect(`${LOGIN_ERROR_PATH}&reason=${encodeURIComponent(error.code)}`);
        return;
      }
      res.fail(500, 'Error inesperado durante la autenticación con Google.');
    }
  }
}
