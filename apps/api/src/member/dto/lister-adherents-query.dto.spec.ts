import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { STATUTS_MEMBRE } from '../member.types';
import { ListerAdherentsQueryDto } from './member.dto';

const erreurs = async (query: Record<string, string>) =>
  (await validate(plainToInstance(ListerAdherentsQueryDto, query))).map((e) => e.property).sort();

describe('ListerAdherentsQueryDto (filtre GET member/adherents)', () => {
  it('accepte PROPOSE_SORTANT et chaque statut choisissable', async () => {
    for (const statut of [...STATUTS_MEMBRE, 'PROPOSE_SORTANT']) {
      expect(await erreurs({ statut })).toEqual([]);
    }
  });

  it('PROPOSE_SORTANT reste hors de STATUTS_MEMBRE (jamais une cible de changement de statut)', () => {
    expect(STATUTS_MEMBRE).not.toContain('PROPOSE_SORTANT');
  });

  it('se combine avec la recherche et le souscripteur', async () => {
    expect(
      await erreurs({
        statut: 'PROPOSE_SORTANT',
        q: 'Kouassi',
        souscripteurId: '3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b',
      }),
    ).toEqual([]);
  });

  it('rejette un statut inconnu et un souscripteurId non UUID', async () => {
    expect(await erreurs({ statut: 'SORTI', souscripteurId: 'abc' })).toEqual([
      'souscripteurId',
      'statut',
    ]);
  });
});
