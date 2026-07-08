// Motor de recordatorios: lógica pura de disparo, desacoplada del driver de DB.

import type {
  Reminder,
  NotificationQueueInsert,
  NotificationPayload,
  ReminderRunResult,
} from './types';

/**
 * Puerto de persistencia del motor. Se define como interfaz para desacoplar la
 * lógica de disparo del driver concreto (Supabase) y permitir tests con dobles
 * en memoria.
 */
export interface ReminderRepository {
  /**
   * Recordatorios en estado 'pendiente' con dueDate <= `now`, ordenados por
   * dueDate ascendente y acotados por `limit`. Los futuros quedan excluidos.
   */
  findDueReminders(now: string, limit: number): Promise<readonly Reminder[]>;

  /**
   * Marca los recordatorios como 'disparado' y encola sus notificaciones.
   * La transición debe filtrar por status = 'pendiente' para garantizar
   * idempotencia ante corridas solapadas del cron. Devuelve los ids realmente
   * disparados (los que este proceso logró reclamar).
   */
  fireReminders(
    reminderIds: readonly string[],
    queueEntries: readonly NotificationQueueInsert[],
  ): Promise<readonly string[]>;
}

/** Reloj inyectable para testear el corte temporal de forma determinista. */
export type Clock = () => Date;

const DEFAULT_BATCH_LIMIT = 500;

/**
 * Motor de recordatorios. `runDueRemindersJob` es el punto de entrada que invoca
 * el cron cada 15 minutos: dispara los recordatorios vencidos y deja intactos los
 * futuros.
 */
export class ReminderEngine {
  private readonly repository: ReminderRepository;
  private readonly clock: Clock;
  private readonly batchLimit: number;

  constructor(
    repository: ReminderRepository,
    clock: Clock = (): Date => new Date(),
    batchLimit: number = DEFAULT_BATCH_LIMIT,
  ) {
    this.repository = repository;
    this.clock = clock;
    this.batchLimit = batchLimit;
  }

  async runDueRemindersJob(): Promise<ReminderRunResult> {
    const ranAt: string = this.clock().toISOString();
    const due: readonly Reminder[] = await this.repository.findDueReminders(
      ranAt,
      this.batchLimit,
    );

    if (due.length === 0) {
      return { firedCount: 0, firedReminderIds: [], ranAt };
    }

    const reminderIds: readonly string[] = due.map((r) => r.id);
    const queueEntries: readonly NotificationQueueInsert[] = due.map((r) =>
      this.toQueueEntry(r),
    );

    const firedReminderIds: readonly string[] =
      await this.repository.fireReminders(reminderIds, queueEntries);

    return {
      firedCount: firedReminderIds.length,
      firedReminderIds,
      ranAt,
    };
  }

  private toQueueEntry(reminder: Reminder): NotificationQueueInsert {
    const payload: NotificationPayload = {
      reminderId: reminder.id,
      clientId: reminder.clientId,
      title: reminder.title,
      dueDate: reminder.dueDate,
    };
    return {
      user_id: reminder.userId,
      reminder_id: reminder.id,
      channel: 'in_app',
      payload,
    };
  }
}
