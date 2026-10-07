import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { MESSAGES_INDISPONIBILITE } from '../adjudication-client/adjudication-client.service';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { PlafondsService } from './plafonds.service';

const USER = { sub: 'u1' } as AuthenticatedUser;

const ADHERENT = {
  id: 'adh-1',
  nom: 'KOUASSI',
  prenom: 'Awa',
  police: { id: 'pol-1' },
  beneficiaires: [
    { id: 'ben-1', nom: 'KOUASSI', prenom: 'Junior' },
    { id: 'ben-2', nom: 'KOUASSI', prenom: 'Léa' },
  ],
};

const ETAT_JAVA = {
  periode: { mode: 'ANNEE_POLICE', debut: '2026-03-01', fin: '2027-02-28' },
  garanties: [
    {
      garantie_id: 'g-1',
      categorie_acte: 'CONSULTATION',
      plafond_personne: 30000,
      plafond_famille: 50000,
      consomme_famille: 43000,
      restant_famille: 7000,
      personnes: [
        { adherent_id: 'adh-1', beneficiaire_id: null, consomme: 12000, restant: 18000 },
        { adherent_id: null, beneficiaire_id: 'ben-1', consomme: 31000, restant: 0 },
        { adherent_id: null, beneficiaire_id: 'ben-2', consomme: 0, restant: 30000 },
      ],
    },
  ],
};

describe('PlafondsService (plafonds annuels restants d’une famille)', () => {
  const service = (roles: string[], adherent: any = ADHERENT, etat: any = ETAT_JAVA) => {
    const adherents = {
      obtenirAdherent: jest.fn().mockResolvedValue(adherent),
    };
    const adjudication = {
      etatPlafonds:
        etat instanceof Error ? jest.fn().mockRejectedValue(etat) : jest.fn().mockResolvedValue(etat),
    };
    const s = new PlafondsService(
      { getMe: jest.fn().mockResolvedValue({ permissions: { roleChain: roles } }) } as any,
      adherents as any,
      adjudication as any,
    );
    return { s, adherents, adjudication };
  };

  it('adhérent : période et restants par personne et pour la famille, nommés ; titulaire = adhérent', async () => {
    const { s, adherents, adjudication } = service(['ADHERENT_TITULAIRE']);

    const r = await s.plafondsFamille(USER, 'adh-1');

    expect(adherents.obtenirAdherent).toHaveBeenCalledWith(USER, 'adh-1'); // périmètre
    expect(adjudication.etatPlafonds).toHaveBeenCalledWith('pol-1', 'adh-1');
    expect(r.periode).toEqual({ mode: 'ANNEE_POLICE', debut: '2026-03-01', fin: '2027-02-28' });
    const g = r.garanties[0];
    expect(g).toMatchObject({ categorieActe: 'CONSULTATION', plafondFamille: 50000, restantFamille: 7000 });
    expect(g.personnes.map((p) => [p.type, p.prenom, p.restant])).toEqual([
      ['TITULAIRE', 'Awa', 18000],
      ['BENEFICIAIRE', 'Junior', 0],
      ['BENEFICIAIRE', 'Léa', 30000],
    ]);
  });

  it('société ASSUREE / ADMINISTRATION : autorisée (périmètre de SA société appliqué par obtenirAdherent)', async () => {
    for (const role of ['SOCIETE_ASSUREE', 'SOCIETE_ADMINISTRATION']) {
      const { s } = service([role]);
      await expect(s.plafondsFamille(USER, 'adh-1')).resolves.toBeDefined();
    }
  });

  it('société RÉCEPTION ou COMPTABLE, centre médical → 403 (consommation de soins : donnée sensible)', async () => {
    for (const role of ['SOCIETE_RECEPTION', 'SOCIETE_COMPTABLE', 'CENTRE_MEDICAL_ACCUEIL']) {
      const { s, adjudication } = service([role]);
      await expect(s.plafondsFamille(USER, 'adh-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(adjudication.etatPlafonds).not.toHaveBeenCalled();
    }
  });

  it('adhérent d’une autre société / autre adhérent → 404 propagé, aucun calcul', async () => {
    const { s, adherents, adjudication } = service(['SOCIETE_ASSUREE']);
    adherents.obtenirAdherent.mockRejectedValue(new NotFoundException('Adhérent introuvable.'));
    await expect(s.plafondsFamille(USER, 'adh-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(adjudication.etatPlafonds).not.toHaveBeenCalled();
  });

  it('adhérent sans police → aucun plafond, sans appel au microservice', async () => {
    const { s, adjudication } = service(['ADHERENT_TITULAIRE'], { ...ADHERENT, police: null });
    await expect(s.plafondsFamille(USER, 'adh-1')).resolves.toEqual({ periode: null, garanties: [] });
    expect(adjudication.etatPlafonds).not.toHaveBeenCalled();
  });

  it('microservice indisponible → 503 avec un message clair, sans détail technique', async () => {
    const { s } = service(['ADHERENT_TITULAIRE'], ADHERENT, new Error('fetch failed ECONNREFUSED'));
    const err = await s.plafondsFamille(USER, 'adh-1').catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.message).toBe(MESSAGES_INDISPONIBILITE.plafonds);
  });
});
