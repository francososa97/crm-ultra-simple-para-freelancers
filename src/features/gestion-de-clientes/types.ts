// Tipos del dominio de Gestión de Clientes.
// Se definen aquí de forma explícita; si src/shared/types/index.ts expone
// equivalentes, reexportarlos desde este módulo para evitar duplicación.

/** Tipos de interacción soportados con un cliente. */
export type InteractionType = 'call' | 'email' | 'meeting' | 'note' | 'whatsapp';

export const INTERACTION_TYPES: readonly InteractionType[] = [
  'call',
  'email',
  'meeting',
  'note',
  'whatsapp',
] as const;

/** Interacción registrada contra un cliente. */
export interface Interaction {
  readonly id: string;
  readonly clientId: string;
  readonly type: InteractionType;
  readonly note: string;
  /** ISO-8601 (UTC). */
  readonly createdAt: string;
}

/** Payload de entrada para crear una interacción. */
export interface CreateInteractionInput {
  readonly type: InteractionType;
  readonly note: string;
}

/** Cliente con su historial de interacciones ordenado por fecha (desc). */
export interface Client {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly createdAt: string;
  readonly interactions: readonly Interaction[];
}

/** Error de dominio con un código estable para mapear a HTTP. */
export class DomainError extends Error {
  constructor(
    public readonly code: 'CLIENT_NOT_FOUND' | 'VALIDATION_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function isInteractionType(value: unknown): value is InteractionType {
  return (
    typeof value === 'string' &&
    (INTERACTION_TYPES as readonly string[]).includes(value)
  );
}
