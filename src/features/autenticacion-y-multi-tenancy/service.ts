// Service de acceso a `clients` con aislamiento multi-tenant.
//
// Defensa en profundidad:
//   1. Postgres RLS (ver rls-policies.ts) filtra por user_id = JWT.sub a nivel DB.
//   2. Este service abre cada operación con `withTenant(user.id, ...)`, de modo que
//      el claim del tenant queda seteado en la sesión y RLS aplica.
//   3. Guardas en la app validan el usuario y verifican el tenant de cada fila leída,
//      para que un fallo de configuración de RLS no derive en fuga de datos.

import type {
  AuthenticatedUser,
  Client,
  CreateClientInput,
  SqlExecutor,
  UserId,
} from '../../shared/types/index';
import { TenantAccessError, UnauthenticatedError } from '../../shared/types/index';

interface ClientRow {
  readonly id: string;
  readonly user_id: string;
  readonly name: string;
  readonly email: string | null;
  readonly company: string | null;
  readonly created_at: string;
}

function mapRow(row: ClientRow): Client {
  return {
    id: row.id,
    userId: row.user_id as UserId,
    name: row.name,
    email: row.email,
    company: row.company,
    createdAt: row.created_at,
  };
}

function assertAuthenticated(user: AuthenticatedUser | null | undefined): AuthenticatedUser {
  if (!user || !user.id) {
    throw new UnauthenticatedError();
  }
  return user;
}

export class ClientsService {
  constructor(private readonly db: SqlExecutor) {}

  /**
   * Lista los clientes del tenant autenticado.
   * RLS garantiza que sólo vuelvan filas con user_id = user.id; la guarda de la app
   * es una verificación redundante (defensa en profundidad).
   */
  async listClients(user: AuthenticatedUser | null | undefined): Promise<readonly Client[]> {
    const auth = assertAuthenticated(user);
    return this.db.withTenant(auth.id, async (tx) => {
      const { rows } = await tx.query<ClientRow>(
        'SELECT id, user_id, name, email, company, created_at FROM public.clients ORDER BY created_at DESC',
        [],
      );
      for (const row of rows) {
        if (row.user_id !== auth.id) {
          // No debería ocurrir si RLS está activo: significa fuga de tenant.
          throw new TenantAccessError();
        }
      }
      return rows.map(mapRow);
    });
  }

  /**
   * Obtiene un cliente por id dentro del tenant. Devuelve null si no existe o
   * pertenece a otro tenant (RLS lo hace invisible → 0 filas → null → 404 en la capa HTTP).
   */
  async getClientById(
    user: AuthenticatedUser | null | undefined,
    clientId: string,
  ): Promise<Client | null> {
    const auth = assertAuthenticated(user);
    return this.db.withTenant(auth.id, async (tx) => {
      const { rows } = await tx.query<ClientRow>(
        'SELECT id, user_id, name, email, company, created_at FROM public.clients WHERE id = $1 LIMIT 1',
        [clientId],
      );
      const row = rows[0];
      if (!row) {
        return null;
      }
      if (row.user_id !== auth.id) {
        throw new TenantAccessError();
      }
      return mapRow(row);
    });
  }

  /**
   * Crea un cliente asignándolo SIEMPRE al tenant autenticado. El user_id nunca
   * proviene del input del cliente; el WITH CHECK de RLS rechaza cualquier otro valor.
   */
  async createClient(
    user: AuthenticatedUser | null | undefined,
    input: CreateClientInput,
  ): Promise<Client> {
    const auth = assertAuthenticated(user);
    const name = input.name.trim();
    if (name.length === 0) {
      throw new Error('name is required');
    }
    return this.db.withTenant(auth.id, async (tx) => {
      const { rows } = await tx.query<ClientRow>(
        `INSERT INTO public.clients (user_id, name, email, company)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id, name, email, company, created_at`,
        [auth.id, name, input.email ?? null, input.company ?? null],
      );
      const row = rows[0];
      if (!row) {
        throw new Error('insert failed');
      }
      return mapRow(row);
    });
  }
}
