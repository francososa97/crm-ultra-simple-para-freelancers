// Implementación del ClientRepository sobre Supabase.
// Solo lee del tenant (columna user_id); el filtro por texto lo hace el servicio.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Client, UserId } from '../../shared/types/index.js';
import type { ClientRepository } from './service.js';

/** Forma de la fila cruda tal como la devuelve la tabla `clients`. */
interface ClientRow {
  readonly id: string;
  readonly user_id: string;
  readonly name: string;
  readonly email: string | null;
  readonly company: string | null;
  readonly created_at: string;
}

/** Columnas seleccionadas; explícitas para no depender de `select('*')`. */
const CLIENT_COLUMNS = 'id, user_id, name, email, company, created_at';

/** Mapea la fila snake_case de la DB al tipo de dominio camelCase. */
function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    userId: row.user_id as UserId,
    name: row.name,
    email: row.email,
    company: row.company,
    createdAt: row.created_at,
  };
}

/** Crea un ClientRepository respaldado por Supabase. */
export function createSupabaseClientRepository(db: SupabaseClient): ClientRepository {
  return {
    async listByUser(userId: UserId): Promise<readonly Client[]> {
      const { data, error } = await db
        .from('clients')
        .select(CLIENT_COLUMNS)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error !== null) {
        throw new Error(`No se pudieron listar los clientes: ${error.message}`);
      }

      const rows = (data ?? []) as readonly ClientRow[];
      return rows.map(toClient);
    },
  };
}
