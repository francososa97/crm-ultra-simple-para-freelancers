// Cliente de email sobre Resend. Encapsula el SDK detras del puerto
// `EmailSender` para mantener el worker testeable y desacoplado del proveedor.

import { Resend } from 'resend';

/** Mensaje de email listo para entregar. */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
}

/** Identificador del mensaje devuelto por el proveedor tras un envio exitoso. */
export interface EmailSendResult {
  readonly providerMessageId: string;
}

/** Puerto de envio de email. El worker depende de esta abstraccion, no de Resend. */
export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/** Error lanzado cuando el proveedor rechaza o no confirma el envio. */
export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailSendError';
  }
}

export interface ResendEmailSenderConfig {
  readonly apiKey: string;
  /** Remitente verificado en Resend, ej. "CRM <no-reply@midominio.com>". */
  readonly from: string;
}

/** Implementacion de `EmailSender` respaldada por Resend. */
export class ResendEmailSender implements EmailSender {
  private readonly client: Resend;
  private readonly from: string;

  constructor(config: ResendEmailSenderConfig) {
    this.client = new Resend(config.apiKey);
    this.from = config.from;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const { data, error } = await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
    });

    if (error !== null) {
      throw new EmailSendError(`Resend rechazo el envio: ${error.message}`);
    }
    if (data === null) {
      throw new EmailSendError('Resend no devolvio un id de mensaje');
    }

    return { providerMessageId: data.id };
  }
}
