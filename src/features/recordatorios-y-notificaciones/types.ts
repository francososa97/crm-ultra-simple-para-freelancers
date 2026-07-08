// Tipos de la feature "Recordatorios y notificaciones".
// Modelan la tabla `reminders` y la cola `notification_queue`.

import type { UserId } from '../../shared/types/index';

/** Estado de un recordatorio en su ciclo de vida. */
export type ReminderStatus = 'pendiente' | 'disparado' | 'cancelado';

/** Canal por el que se entregará la notificación encolada. */
export type NotificationChannel = 'email' | 'in_app';

/**
 * Fila de la tabla `reminders`. `userId` es la columna de tenancy (user_id en DB).
 * `dueDate` (due_date en DB) es el instante a partir del cual debe dispararse.
 */
export interface Reminder {
  readonly id: string;
  readonly userId: UserId;
  /** Cliente asociado (client_id en DB). null para recordatorios sueltos. */
  readonly clientId: string | null;
  readonly title: string;
  /** ISO-8601 UTC. Momento de vencimiento (due_date). */
  readonly dueDate: string;
  readonly status: ReminderStatus;
  readonly createdAt: string;
}

/** Contenido que el worker de entrega usará para construir la notificación. */
export interface NotificationPayload {
  readonly reminderId: string;
  readonly clientId: string | null;
  readonly title: string;
  readonly dueDate: string;
}

/** Filas nuevas a insertar en `notification_queue` (sin columnas generadas por DB). */
export interface NotificationQueueInsert {
  readonly user_id: UserId;
  readonly reminder_id: string;
  readonly channel: NotificationChannel;
  readonly payload: NotificationPayload;
}

/** Resultado de una corrida del motor de recordatorios. */
export interface ReminderRunResult {
  readonly firedCount: number;
  readonly firedReminderIds: readonly string[];
  /** ISO-8601 UTC del corte temporal usado como `now`. */
  readonly ranAt: string;
}
