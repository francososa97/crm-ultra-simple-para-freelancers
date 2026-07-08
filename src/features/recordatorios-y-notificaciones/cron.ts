// Adaptador Supabase + handler del cron job (cada 15 min) de recordatorios.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { UserId } from '../../shared/types/index';
import { ReminderEngine, type ReminderRepository } from './service';
import type {
  Reminder,
  NotificationQueueInsert,
  ReminderRunResult,
  ReminderStatus,
} from './types';

/** Forma cruda de una fila de `reminders` tal como la devuelve postgREST. */
interface ReminderRow {
  readonly id: string;
  readonly user_id: string;
  readonly client_id: string | null;
  readonly title: string;
  readonly due_date: string;
  readonly status: ReminderStatus;
  readonly created_at: string;
}

/** Fila devuelta por los `.select('id')` de las mutaciones. */
interface IdRow {
  readonly id: string;
}

function mapRow(row: ReminderRow): Reminder {
  return {
    id: row.id,
    userId: row.user_id as UserId,
    clientId: row.client_id,
    title: row.title,
    dueDate: row.due_date,
    status: row.status,
    createdAt: row.created_at,
  };
}

/**
 * Implementación del puerto sobre Supabase. Usa un patrón reclamar-y-encolar para
 * lograr idempotencia sin una transacción multi-sentencia: primero se hace el
 * UPDATE condicionado a status='pendiente' (solo una corrida gana la fila) y
 * recién después se encolan las notificaciones de las filas efectivamente
 * reclamadas.
 */
export class SupabaseReminderRepository implements ReminderRepository {
  private readonly db: SupabaseClient;

  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async findDueReminders(now: string, limit: number): Promise<readonly Reminder[]> {
    const { data, error } = await this.db
      .from('reminders')
      .select('id, user_id, client_id, title, due_date, status, created_at')
      .eq('status', 'pendiente')
      .lte('due_date', now)
      .order('due_date', { ascending: true })
      .limit(limit);

    if (error !== null) {
      throw new Error(`findDueReminders falló: ${error.message}`);
    }
    const rows: ReminderRow[] = (data as ReminderRow[] | null) ?? [];
    return rows.map(mapRow);
  }

  async fireReminders(
    reminderIds: readonly string[],
    queueEntries: readonly NotificationQueueInsert[],
  ): Promise<readonly string[]> {
    if (reminderIds.length === 0) {
      return [];
    }

    // Paso 1: reclamar atómicamente. El filtro status='pendiente' evita que dos
    // corridas solapadas disparen el mismo recordatorio dos veces.
    const { data: claimedData, error: claimError } = await this.db
      .from('reminders')
      .update({ status: 'disparado' })
      .in('id', [...reminderIds])
      .eq('status', 'pendiente')
      .select('id');

    if (claimError !== null) {
      throw new Error(`fireReminders (claim) falló: ${claimError.message}`);
    }

    const claimedRows: IdRow[] = (claimedData as IdRow[] | null) ?? [];
    const claimedIds: Set<string> = new Set(claimedRows.map((r) => r.id));
    if (claimedIds.size === 0) {
      return [];
    }

    // Paso 2: encolar solo las notificaciones de los recordatorios reclamados.
    const entriesToInsert: NotificationQueueInsert[] = queueEntries.filter((e) =>
      claimedIds.has(e.reminder_id),
    );
    const { error: insertError } = await this.db
      .from('notification_queue')
      .insert(entriesToInsert);

    if (insertError !== null) {
      throw new Error(`fireReminders (enqueue) falló: ${insertError.message}`);
    }

    return [...claimedIds];
  }
}

/** Lee configuración obligatoria del entorno o falla ruidosamente. */
function requireEnv(name: string): string {
  const value: string | undefined = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

/**
 * Punto de entrada invocado por el scheduler cada 15 minutos.
 * Usa la service role key porque corre fuera de un contexto de usuario y debe
 * poder leer/escribir recordatorios de todos los tenants.
 */
export async function handleReminderCron(): Promise<ReminderRunResult> {
  const db: SupabaseClient = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  );

  const engine = new ReminderEngine(new SupabaseReminderRepository(db));
  return engine.runDueRemindersJob();
}
