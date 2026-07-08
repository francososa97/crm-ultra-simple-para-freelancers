// Rutas HTTP (Express) de Gestión de Clientes.
// Monta bajo /api/clients: `app.use('/api/clients', clientsRouter)`.

import { Request, Response, Router } from 'express';
import { ClientService, clientService } from './service';
import { CreateInteractionInput, DomainError } from './types';

export function createClientsRouter(service: ClientService = clientService): Router {
  const router = Router();

  // GET /api/clients/:id -> cliente + interacciones ordenadas por fecha desc.
  router.get('/:id', (req: Request, res: Response): void => {
    try {
      const client = service.getClient(req.params.id);
      res.status(200).json(client);
    } catch (err) {
      handleError(err, res);
    }
  });

  // POST /api/clients/:id/interactions -> registra interacción, 201.
  router.post('/:id/interactions', (req: Request, res: Response): void => {
    try {
      const body = (req.body ?? {}) as Partial<CreateInteractionInput>;
      const interaction = service.addInteraction(req.params.id, {
        type: body.type as CreateInteractionInput['type'],
        note: body.note as string,
      });
      res.status(201).json(interaction);
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}

function handleError(err: unknown, res: Response): void {
  if (err instanceof DomainError) {
    const status = err.code === 'CLIENT_NOT_FOUND' ? 404 : 400;
    res.status(status).json({ error: err.code, message: err.message });
    return;
  }
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Error inesperado' });
}

export const clientsRouter = createClientsRouter();
