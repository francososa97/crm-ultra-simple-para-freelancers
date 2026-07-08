import { randomUUID } from 'node:crypto';
import type { Client, CreateClientInput } from './types';

/** Se lanza cuando el payload de creación es inválido. */
export class ClientValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientValidationError';
  }
}

/** Se lanza cuando el cliente no existe o no pertenece al usuario. */
export class ClientNotFoundError extends Error {
  constructor(id: string) {
    super(`Cliente ${id} no encontrado`);
    this.name = 'ClientNotFoundError';
  }
}

/**
 * Lógica de negocio del CRUD de clientes.
 *
 * Usa un almacenamiento en memoria (Map) para mantener la task autocontenida.
 * Reemplazar el Map por un repositorio persistente no altera la firma pública.
 * Todas las operaciones están aisladas por `ownerId` (usuario autenticado).
 */
export class ClientService {
  private readonly clients = new Map<string, Client>();

  /** Crea un cliente activo para el usuario dado. */
  create(ownerId: string, input: CreateClientInput): Client {
    const nombre = this.requireText(input.nombre, 'nombre');
    const contacto = this.requireText(input.contacto, 'contacto');

    const now = new Date().toISOString();
    const client: Client = {
      id: randomUUID(),
      ownerId,
      nombre,
      contacto,
      activo: true,
      createdAt: now,
      updatedAt: now,
    };

    this.clients.set(client.id, client);
    return client;
  }

  /** Lista los clientes activos del usuario, más recientes primero. */
  listActive(ownerId: string): Client[] {
    return [...this.clients.values()]
      .filter((client) => client.ownerId === ownerId && client.activo)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Devuelve un cliente activo por id o lanza ClientNotFoundError. */
  getById(ownerId: string, id: string): Client {
    const client = this.clients.get(id);
    if (!client || client.ownerId !== ownerId || !client.activo) {
      throw new ClientNotFoundError(id);
    }
    return client;
  }

  /**
   * Soft-delete: marca el cliente como inactivo.
   * Idempotente en la práctica: si ya está inactivo o no existe, lanza NotFound.
   */
  deactivate(ownerId: string, id: string): Client {
    const existing = this.getById(ownerId, id);
    const updated: Client = {
      ...existing,
      activo: false,
      updatedAt: new Date().toISOString(),
    };
    this.clients.set(updated.id, updated);
    return updated;
  }

  private requireText(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ClientValidationError(`El campo '${field}' es obligatorio`);
    }
    return value.trim();
  }
}
