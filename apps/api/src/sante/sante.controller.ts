import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SanteService } from './sante.service';

/**
 * `GET /api/v1/sante` — sonde de supervision, NON authentifiée (aucune donnée
 * métier exposée). 200 si l'API, sa base et le microservice d'adjudication sont
 * opérationnels ; 503 sinon, avec le détail par composant.
 */
@Controller('sante')
export class SanteController {
  constructor(private readonly sante: SanteService) {}

  @Get()
  async etat(@Res({ passthrough: true }) res: Response) {
    const etat = await this.sante.etat();
    res.status(etat.statut === 'UP' ? 200 : 503);
    return etat;
  }
}
