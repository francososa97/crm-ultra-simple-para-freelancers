// Worker de la cola de notificaciones (Task E3-T2).
//
// Toma registros `notification_queue` de tipo email, los envia via Resend y
// actualiza `status` a 'sent'. Ante fallos reintenta hasta MAX_DELIVERY_ATTEMPTS
// veces; si todos los intentos fallan, el registro queda en 'failed'.

import type { EmailSender } from './resend-client';
import { EmailSendError } from './resend-client';
import type { DeliveryOutcome, QueuedNotification } from './types';
import { MAX_DELIVERY_ATTEMPTS } from './types';

/**
 * Puerto de persistencia de la cola. La implementacion concreta (Supabase)
 * vive en la capa de infraestructura de la feature.
 */
export interface NotificationQueueRepository {
  /**
   * Reclama de forma atomica hasta `limit` notificaciones de email pendientes,
   * marcandolas como 'processing' para evitar que otro worker las tome.
   */
  claimPendingEmails(limit: number): Promise<readonly QueuedNotification[]>;
  /** Marca la notificacion como 'sent' y persiste el id del proveedor. */
  markSent(id: string, providerMessageId: string): Promise<void>;
  /** Marca la notificacion como 'failed' registrando intentos y ultimo error. */
  markFailed(id: string, attempts: number, lastError: string): Promise<void>;
}

/** Logger minimo requerido por el worker. */
export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface NotificationWorkerConfig {
  /** Cuantas notificaciones reclamar por ciclo. Default 25. */
  readonly batchSize?: number;
  /** Base del backoff exponencial entre reintentos, en ms. Default 200. */
  readonly retryBaseDelayMs?: number;
  /** Inyectable en tests para no dormir de verdad. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_RETRY_BASE_DELAY_MS = 200;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Procesa la cola de notificaciones por email. Disenado para invocarse desde
 * un cron/poller: cada llamada a `processQueue` procesa un lote y retorna.
 */
export class NotificationWorker {
  private readonly batchSize: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly repository: NotificationQueueRepository,
    private readonly emailSender: EmailSender,
    private readonly logger: Logger,
    config: NotificationWorkerConfig = {},
  ) {
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.sleep = config.sleep ?? defaultSleep;
  }

  /**
   * Reclama y procesa un lote de emails pendientes.
   * @returns los resultados de entrega de cada notificacion del lote.
   */
  async processQueue(): Promise<readonly DeliveryOutcome[]> {
    const batch = await this.repository.claimPendingEmails(this.batchSize);
    if (batch.length === 0) {
      return [];
    }

    this.logger.info('Procesando lote de notificaciones email', {
      count: batch.length,
    });

    const outcomes: DeliveryOutcome[] = [];
    for (const notification of batch) {
      outcomes.push(await this.processOne(notification));
    }
    return outcomes;
  }

  /**
   * Envia una notificacion reintentando hasta MAX_DELIVERY_ATTEMPTS.
   * Persiste el estado final ('sent' o 'failed') antes de retornar.
   */
  async processOne(notification: QueuedNotification): Promise<DeliveryOutcome> {
    let lastError = 'sin intentos ejecutados';

    for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      try {
        const { providerMessageId } = await this.emailSender.send({
          to: notification.recipient,
          subject: notification.subject,
          html: notification.body,
        });

        await this.repository.markSent(notification.id, providerMessageId);
        this.logger.info('Notificacion enviada', {
          notificationId: notification.id,
          attempt,
          providerMessageId,
        });
        return { kind: 'sent', providerMessageId };
      } catch (error: unknown) {
        lastError = toErrorMessage(error);
        this.logger.error('Fallo el envio de notificacion', {
          notificationId: notification.id,
          attempt,
          maxAttempts: MAX_DELIVERY_ATTEMPTS,
          error: lastError,
        });

        // Backoff exponencial entre reintentos; no dormimos tras el ultimo.
        if (attempt < MAX_DELIVERY_ATTEMPTS) {
          await this.sleep(this.retryBaseDelayMs * 2 ** (attempt - 1));
        }
      }
    }

    await this.repository.markFailed(
      notification.id,
      MAX_DELIVERY_ATTEMPTS,
      lastError,
    );
    return { kind: 'failed', attempts: MAX_DELIVERY_ATTEMPTS, lastError };
  }
}

/** Normaliza cualquier valor capturado a un mensaje de error legible. */
function toErrorMessage(error: unknown): string {
  if (error instanceof EmailSendError || error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'error desconocido';
}
