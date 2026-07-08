// Tipos de la cola de notificaciones (tabla `notification_queue`).
// Feature: Recordatorios y notificaciones - Task E3-T2 (envio por email).

import type { UserId } from '../../shared/types/index';

/** Canales de entrega soportados. Por ahora solo email (Resend). */
export type NotificationChannel = 'email';

/**
 * Estados del ciclo de vida de una notificacion encolada.
 * - `pending`: aun no procesada o a la espera de un nuevo intento.
 * - `processing`: reclamada por un worker (evita doble envio entre pollers).
 * - `sent`: entregada al proveedor con exito.
 * - `failed`: descartada tras agotar los reintentos.
 */
export type NotificationStatus = 'pending' | 'processing' | 'sent' | 'failed';

/** Maximo de intentos de entrega antes de marcar la notificacion como `failed`. */
export const MAX_DELIVERY_ATTEMPTS = 3;

/**
 * Fila de la tabla `notification_queue`.
 * `userId` es la columna de tenancy (user_id en DB); nunca se envia a un
 * destinatario que no pertenezca al tenant dueno del registro.
 */
export interface QueuedNotification {
  readonly id: string;
  readonly userId: UserId;
  readonly channel: NotificationChannel;
  /** Direccion de email del destinatario (validada al encolar). */
  readonly recipient: string;
  readonly subject: string;
  /** Cuerpo del email en HTML. */
  readonly body: string;
  readonly status: NotificationStatus;
  /** Intentos de entrega ya realizados. Arranca en 0. */
  readonly attempts: number;
  readonly createdAt: string;
}

/** Resultado de procesar una notificacion individual. */
export type DeliveryOutcome =
  | { readonly kind: 'sent'; readonly providerMessageId: string }
  | { readonly kind: 'failed'; readonly attempts: number; readonly lastError: string };
