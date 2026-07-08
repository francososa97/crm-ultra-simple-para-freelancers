// Lógica de negocio de Gestión de Clientes.
// Repositorio en memoria: reemplazable por una capa de persistencia real
// manteniendo la misma interfaz pública del servicio.

import { randomUUID } from 'node:crypto';
import {
  Client,
  CreateInteractionInput,
  DomainError,
  Interaction,
  isInteractionType,
} from './types';

interface StoredClient {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  interactions: Interaction[];
}

export class ClientService {
  private readonly clients = new Map<string, StoredClient>();

  /** Genera timestamps ISO; inyectable para tests deterministas. */
  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Alta de cliente (soporte para seed/tests). */
  createClient(name: string, email: string): Client {
    const id = randomUUID();
    const stored: StoredClient = {
      id,
      name,
      email,
      createdAt: this.now().toISOString(),
      interactions: [],
    };
    this.clients.set(id, stored);
    return this.toClient(stored);
  }

  /** Devuelve el cliente con interacciones ordenadas por fecha descendente. */
  getClient(id: string): Client {
    const stored = this.clients.get(id);
    if (!stored) {
      throw new DomainError('CLIENT_NOT_FOUND', `Cliente ${id} no encontrado`);
    }
    return this.toClient(stored);
  }

  /**
   * Registra una interacción para un cliente existente.
   * @throws DomainError CLIENT_NOT_FOUND | VALIDATION_ERROR
   */
  addInteraction(clientId: string, input: CreateInteractionInput): Interaction {
    const stored = this.clients.get(clientId);
    if (!stored) {
      throw new DomainError('CLIENT_NOT_FOUND', `Cliente ${clientId} no encontrado`);
    }

    this.validate(input);

    const interaction: Interaction = {
      id: randomUUID(),
      clientId,
      type: input.type,
      note: input.note.trim(),
      createdAt: this.now().toISOString(),
    };

    stored.interactions.push(interaction);
    return interaction;
  }

  private validate(input: CreateInteractionInput): void {
    if (!isInteractionType(input.type)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Tipo de interacción inválido: ${String(input.type)}`,
      );
    }
    if (typeof input.note !== 'string' || input.note.trim().length === 0) {
      throw new DomainError('VALIDATION_ERROR', 'La nota es obligatoria');
    }
  }

  /** Proyecta el estado interno al modelo público con orden por fecha desc. */
  private toClient(stored: StoredClient): Client {
    const interactions = [...stored.interactions].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    return {
      id: stored.id,
      name: stored.name,
      email: stored.email,
      createdAt: stored.createdAt,
      interactions,
    };
  }
}

/** Instancia compartida por defecto para la app. */
export const clientService = new ClientService();
