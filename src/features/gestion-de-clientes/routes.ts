import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  ClientService,
  ClientValidationError,
  ClientNotFoundError,
} from './service';
import { toClientDTO, type CreateClientInput } from './types';

/**
 * Request con el usuario autenticado inyectado por el middleware de auth
 * (p. ej. verificación de JWT/sesión aguas arriba). El router asume que
 * `req.userId` está presente; si no lo está responde 401.
 */
interface AuthenticatedRequest extends Request {
  userId?: string;
}

function requireUserId(req: AuthenticatedRequest, res: Response): string | null {
  const userId = req.userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    res.status(401).json({ error: 'No autenticado' });
    return null;
  }
  return userId;
}

function parseCreateBody(body: unknown): CreateClientInput {
  const source = (body ?? {}) as Record<string, unknown>;
  return {
    nombre: typeof source.nombre === 'string' ? source.nombre : '',
    contacto: typeof source.contacto === 'string' ? source.contacto : '',
  };
}

/**
 * Monta las rutas del CRUD de clientes bajo el prefijo /api/clients.
 *
 * Endpoints:
 *   POST   /api/clients      -> 201 crea cliente
 *   GET    /api/clients      -> 200 lista clientes activos
 *   DELETE /api/clients/:id  -> 204 soft-delete (marca inactivo)
 */
export function createClientsRouter(service: ClientService = new ClientService()): Router {
  const router = Router();

  router.post('/', (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUserId(req, res);
      if (userId === null) return;

      const client = service.create(userId, parseCreateBody(req.body));
      res.status(201).json(toClientDTO(client));
    } catch (err) {
      if (err instanceof ClientValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  router.get('/', (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUserId(req, res);
      if (userId === null) return;

      const clients = service.listActive(userId).map(toClientDTO);
      res.status(200).json(clients);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUserId(req, res);
      if (userId === null) return;

      service.deactivate(userId, req.params.id);
      res.status(204).end();
    } catch (err) {
      if (err instanceof ClientNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  return router;
}
