// Tipos compartidos del CRM. Reutilizables por todas las features.

/** Identificador de usuario/tenant. Branded para evitar mezclar strings sueltos. */
export type UserId = string & { readonly __brand: 'UserId' };

/** Usuario autenticado extraído del JWT de Supabase Auth. */
export interface AuthenticatedUser {
  readonly id: UserId;
  readonly email: string;
}

/** Fila de la tabla `clients`. `userId` es la columna de tenancy (user_id en DB). */
export interface Client {
  readonly id: string;
  readonly userId: UserId;
  readonly name: string;
  readonly email: string | null;
  readonly company: string | null;
  readonly createdAt: string;
}

/** Payload aceptado al crear un cliente. El tenant se inyecta desde el contexto, nunca del input. */
export interface CreateClientInput {
  readonly name: string;
  readonly email?: string | null;
  readonly company?: string | null;
}

/** Error de dominio con código estable para mapear a HTTP. */
export class TenantAccessError extends Error {
  readonly httpStatus: 403;
  constructor(message = 'Forbidden: cross-tenant access denied') {
    super(message);
    this.name = 'TenantAccessError';
    this.httpStatus = 403;
  }
}

export class UnauthenticatedError extends Error {
  readonly httpStatus: 401;
  constructor(message = 'Unauthenticated') {
    super(message);
    this.name = 'UnauthenticatedError';
    this.httpStatus = 401;
  }
}

/** Contrato mínimo del cliente Postgres/Supabase que consume el service (para testeabilidad). */
export interface QueryResult<T> {
  readonly rows: readonly T[];
}

export interface SqlExecutor {
  /**
   * Ejecuta SQL parametrizado. Debe correr con el rol/tenant seteado vía `withTenant`
   * para que las políticas RLS de Postgres apliquen.
   */
  query<T>(sql: string, params: readonly unknown[]): Promise<QueryResult<T>>;

  /**
   * Abre una transacción/sesión con `set_config('request.jwt.claim.sub', userId)`
   * de modo que RLS filtre por el tenant. Garantiza aislamiento a nivel DB.
   */
  withTenant<T>(
    userId: UserId,
    fn: (tx: SqlExecutor) => Promise<T>,
  ): Promise<T>;
}
