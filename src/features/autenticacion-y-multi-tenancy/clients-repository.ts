/**
 * Repositorio de `clients` con aislamiento por tenant.
 *
 * Defensa en profundidad:
 *  1) RLS en Postgres (ver rls-policies.ts) es la barrera dura: aunque este
 *     código tuviera un bug, la DB no expone filas de otro tenant.
 *  2) Este repositorio además setea explícitamente `user_id` en escrituras y
 *     filtra por `user_id` en lecturas, para fallar de forma segura y clara.
 */

import type { TenantContext } from './tenant-context';

const TABLE = 'clients';

export interface Client {
  readonly id: string;
  readonly user_id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly created_at: string;
}

export type NewClient = Pick<Client, 'name'> &
  Partial<Pick<Client, 'email' | 'phone'>>;

export class ForbiddenError extends Error {
  readonly code = 'FORBIDDEN' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class ClientsRepository {
  constructor(private readonly ctx: TenantContext) {}

  /** Lista los clientes del tenant actual. RLS garantiza el aislamiento. */
  async list(): Promise<Client[]> {
    const { data, error } = await this.ctx.db
      .from(TABLE)
      .select('*')
      .eq('user_id', this.ctx.userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Error listando clients: ${error.message}`);
    return (data ?? []) as Client[];
  }

  /**
   * Devuelve un cliente por id. Si pertenece a otro tenant, RLS lo oculta y
   * `.maybeSingle()` devuelve null => tratamos como no encontrado (403/404).
   */
  async findById(id: string): Promise<Client | null> {
    const { data, error } = await this.ctx.db
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .eq('user_id', this.ctx.userId)
      .maybeSingle();

    if (error) throw new Error(`Error obteniendo client: ${error.message}`);
    return (data as Client | null) ?? null;
  }

  /** Crea un cliente forzando el `user_id` del tenant actual. */
  async create(input: NewClient): Promise<Client> {
    const row = {
      user_id: this.ctx.userId,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
    };

    const { data, error } = await this.ctx.db
      .from(TABLE)
      .insert(row)
      .select('*')
      .single();

    // Violación del WITH CHECK de RLS => 42501 (insufficient_privilege).
    if (error) {
      if (error.code === '42501') {
        throw new ForbiddenError('No autorizado a crear este recurso.');
      }
      throw new Error(`Error creando client: ${error.message}`);
    }
    return data as Client;
  }

  /**
   * Elimina un cliente del tenant. Si el id no pertenece al tenant, RLS hace
   * que no matchee ninguna fila => devolvemos false (no encontrado).
   */
  async delete(id: string): Promise<boolean> {
    const { data, error } = await this.ctx.db
      .from(TABLE)
      .delete()
      .eq('id', id)
      .eq('user_id', this.ctx.userId)
      .select('id');

    if (error) throw new Error(`Error eliminando client: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }
}
