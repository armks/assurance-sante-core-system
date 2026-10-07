import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { STATUTS_DOSSIER } from '../care-episode.types';
import { ListerDossiersQueryDto } from './care-episode.dto';

const erreurs = async (query: Record<string, string>) =>
  (await validate(plainToInstance(ListerDossiersQueryDto, query))).map((e) => e.property).sort();

describe('ListerDossiersQueryDto (filtre GET care-episode/dossiers)', () => {
  it('accepte TRANSFERE et chaque statut de dossier', async () => {
    expect(STATUTS_DOSSIER).toContain('TRANSFERE');
    for (const statut of STATUTS_DOSSIER) {
      expect(await erreurs({ statut })).toEqual([]);
    }
  });

  it('se combine avec etablissementId', async () => {
    expect(
      await erreurs({ statut: 'TRANSFERE', etablissementId: '3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b' }),
    ).toEqual([]);
  });

  it('rejette un statut inconnu et un etablissementId non UUID', async () => {
    expect(await erreurs({ statut: 'TRANSFERT', etablissementId: 'undefined' })).toEqual([
      'etablissementId',
      'statut',
    ]);
  });
});
