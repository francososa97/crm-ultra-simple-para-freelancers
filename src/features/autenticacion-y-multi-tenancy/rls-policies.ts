/**
 * Row Level Security (RLS) multi-tenant — definición de políticas.
 *
 * Estrategia de multi-tenancy: tenant = usuario autenticado. Cada fila de las
 * tablas de negocio lleva una columna `user_id` que referencia a `auth.users`.
 * Postgres aplica RLS a nivel de motor, de modo que aunque el código de la
 * aplicación tuviera un bug (p. ej. olvidar el `WHERE user_id = ...`), la base
 * de datos NUNCA devolverá filas de otro tenant.
 *
 * Este módulo exporta el SQL idempotente de las políticas como migración, de
 * forma que pueda versionarse y aplicarse desde CI o desde el Supabase CLI.
 */

/** Tablas de negocio sujetas a aislamiento por tenant. */
export const TENANT_TABLES = ['clients'] as const;

export type TenantTable = (typeof TENANT_TABLES)[number];

/**
 * Genera el SQL de RLS para una tabla dada.
 *
 * - Habilita RLS y fuerza su aplicación incluso para el owner de la tabla.
 * - Define políticas separadas para SELECT / INSERT / UPDATE / DELETE.
 * - `auth.uid()` es la función de Supabase que devuelve el UUID del usuario
 *   presente en el JWT de la request. Si no hay sesión válida devuelve NULL,
 *   y `user_id = NULL` es siempre falso => 0 filas.
 */
export function buildTenantRlsSql(table: TenantTable): string {
  const t = quoteIdent(table);
  return [
    `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`,
    ``,
    `DROP POLICY IF EXISTS "${table}_select_own" ON ${t};`,
    `CREATE POLICY "${table}_select_own" ON ${t}`,
    `  FOR SELECT USING (user_id = auth.uid());`,
    ``,
    `DROP POLICY IF EXISTS "${table}_insert_own" ON ${t};`,
    `CREATE POLICY "${table}_insert_own" ON ${t}`,
    `  FOR INSERT WITH CHECK (user_id = auth.uid());`,
    ``,
    `DROP POLICY IF EXISTS "${table}_update_own" ON ${t};`,
    `CREATE POLICY "${table}_update_own" ON ${t}`,
    `  FOR UPDATE USING (user_id = auth.uid())`,
    `  WITH CHECK (user_id = auth.uid());`,
    ``,
    `DROP POLICY IF EXISTS "${table}_delete_own" ON ${t};`,
    `CREATE POLICY "${table}_delete_own" ON ${t}`,
    `  FOR DELETE USING (user_id = auth.uid());`,
  ].join('\n');
}

/**
 * SQL completo de la migración: aplica RLS a todas las tablas de tenant.
 * Idempotente: puede correrse múltiples veces sin error.
 */
export function buildAllTenantRlsSql(): string {
  const header = '-- Migración RLS multi-tenant (auto-generada, idempotente)\n';
  return header + TENANT_TABLES.map(buildTenantRlsSql).join('\n\n') + '\n';
}

/** Escapa un identificador SQL para prevenir inyección en nombres de tabla. */
function quoteIdent(ident: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(ident)) {
    throw new Error(`Identificador SQL inválido: ${ident}`);
  }
  return `"${ident}"`;
}
