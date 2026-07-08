// Domain types para la gestión de clientes (E2-T1).
// Si src/shared/types/index.ts existe, estos tipos deben reexportarse desde allí.

/**
 * Representa un cliente del freelancer.
 * `activo` implementa el soft-delete: DELETE marca `activo = false`
 * y el cliente deja de aparecer en los listados, sin borrarse físicamente.
 */
export interface Client {
  readonly id: string;
  readonly ownerId: string;
  readonly nombre: string;
  readonly contacto: string;
  readonly activo: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Payload aceptado por POST /api/clients. */
export interface CreateClientInput {
  readonly nombre: string;
  readonly contacto: string;
}

/** Vista pública del cliente que se serializa en las respuestas HTTP. */
export interface ClientDTO {
  readonly id: string;
  readonly nombre: string;
  readonly contacto: string;
  readonly activo: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toClientDTO(client: Client): ClientDTO {
  return {
    id: client.id,
    nombre: client.nombre,
    contacto: client.contacto,
    activo: client.activo,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}
