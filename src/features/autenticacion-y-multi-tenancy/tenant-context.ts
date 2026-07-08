/**
 * Contexto de tenant: crea un cliente Supabase ligado al JWT del usuario
 * autenticado, de modo que TODAS las queries que pasen por él respeten RLS.
 *
 * Regla de oro: para operaciones de negocio NUNCA se usa la `service_role`
 * key (que bypassea RLS). Se usa la `anon` key + el access token del usuario,
 * así Postgres evalúa `auth.uid()` con la identidad correcta.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface TenantConfig {
  readonly supabaseUrl: string;
  /** Clave pública (anon). NO usar service_role aquí: bypassearía RLS. */
  readonly supabaseAnonKey: string;
}

export interface TenantContext {
  /** UUID del usuario/tenant autenticado (== auth.uid() en Postgres). */
  readonly userId: string;
  /** Cliente Supabase con el JWT del usuario inyectado en cada request. */
  readonly db: SupabaseClient;
}

/**
 * Construye un `TenantContext` a partir del access token (JWT) de la sesión
 * del usuario. Valida el token contra Supabase Auth antes de devolver el
 * contexto; si es inválido o está expirado, lanza.
 */
export async function createTenantContext(
  config: TenantConfig,
  accessToken: string,
): Promise<TenantContext> {
  if (!accessToken) {
    throw new UnauthorizedError('Falta el access token del usuario.');
  }

  const db = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await db.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new UnauthorizedError('Sesión inválida o expirada.');
  }

  return { userId: data.user.id, db };
}

/** Error de autenticación (mapear a HTTP 401/403 en la capa de transporte). */
export class UnauthorizedError extends Error {
  readonly code = 'UNAUTHORIZED' as const;
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}
