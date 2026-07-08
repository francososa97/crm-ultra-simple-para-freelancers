// Lógica de búsqueda/filtrado de clientes (E2-T3).
// El filtrado vive en el servicio para ser testeable sin DB y determinista.
// Para <=500 registros el filtro en memoria cumple holgadamente el AC (<300ms).

import type { Client, UserId } from '../../shared/types/index.js';

/** Query params soportados por GET /api/clients. */
export interface ClientSearchQuery {
  /** Texto libre de búsqueda; opcional (ausente = listar todo). */
  readonly q?: string;
}

/** Puerto de acceso a datos. El tenant (userId) se aplica siempre en la capa de repo. */
export interface ClientRepository {
  /** Devuelve los clientes del tenant indicado. Nunca cruza tenants. */
  listByUser(userId: UserId): Promise<readonly Client[]>;
}

/** Parámetros de la operación de búsqueda. El tenant viene del contexto, no del input. */
export interface SearchClientsParams {
  readonly userId: UserId;
  readonly query: ClientSearchQuery;
}

/** Límite defensivo: evita términos absurdamente largos en el input HTTP. */
const MAX_TERM_LENGTH = 100;

/**
 * Normaliza el término de búsqueda: recorta espacios, pasa a minúsculas y trunca.
 * Devuelve '' cuando no hay término efectivo (lo que significa "sin filtro").
 */
export function normalizeSearchTerm(raw: string | undefined): string {
  if (raw === undefined) {
    return '';
  }
  return raw.trim().toLowerCase().slice(0, MAX_TERM_LENGTH);
}

/** Un cliente matchea si su nombre o email contiene el término (case-insensitive). */
function matchesTerm(client: Client, term: string): boolean {
  if (term === '') {
    return true;
  }
  const nameMatches = client.name.toLowerCase().includes(term);
  if (nameMatches) {
    return true;
  }
  const email = client.email;
  return email !== null && email.toLowerCase().includes(term);
}

/**
 * Busca clientes del tenant filtrando por nombre o email (case-insensitive).
 * Si el término normalizado es vacío, devuelve todos los clientes del tenant.
 */
export async function searchClients(
  repo: ClientRepository,
  params: SearchClientsParams,
): Promise<readonly Client[]> {
  const term = normalizeSearchTerm(params.query.q);
  const all = await repo.listByUser(params.userId);
  if (term === '') {
    return all;
  }
  return all.filter((client) => matchesTerm(client, term));
}
