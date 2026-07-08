// Controlador framework-agnóstico para GET /api/clients?q=texto (E2-T3).
// Recibe el usuario autenticado (ya resuelto del JWT) y el query param crudo,
// y devuelve un resultado HTTP plano que cualquier adapter (Express, Fastify,
// Edge Function) puede serializar.

import type { AuthenticatedUser, Client } from '../../shared/types/index.js';
import { searchClients, type ClientRepository } from './service.js';

/** Entrada del controlador. `queryParam` es el valor crudo de `?q=`. */
export interface GetClientsRequest {
  readonly user: AuthenticatedUser;
  readonly queryParam: string | undefined;
}

/** Cuerpo de respuesta exitosa. */
export interface ClientListBody {
  readonly clients: readonly Client[];
}

/** Cuerpo de respuesta de error. */
export interface ErrorBody {
  readonly error: string;
}

/** Resultado HTTP plano, listo para serializar por el adapter de transporte. */
export interface HttpResult<TBody> {
  readonly status: number;
  readonly body: TBody;
}

/**
 * Maneja GET /api/clients. El tenant se toma SIEMPRE de `request.user.id`,
 * nunca del input del cliente, garantizando aislamiento por tenant.
 */
export async function handleGetClients(
  repo: ClientRepository,
  request: GetClientsRequest,
): Promise<HttpResult<ClientListBody> | HttpResult<ErrorBody>> {
  try {
    const clients = await searchClients(repo, {
      userId: request.user.id,
      query: { q: request.queryParam },
    });
    return { status: 200, body: { clients } };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Error desconocido';
    return { status: 500, body: { error: message } };
  }
}
