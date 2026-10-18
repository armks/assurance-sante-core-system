import { ajouterMois, calculerEtat, calculerPeriode, ESSAI_JOURS, type LicenceBrute } from './licence-etat';

const jour = (s: string) => new Date(`${s}T00:00:00Z`);
const licence = (o: Partial<LicenceBrute> = {}): LicenceBrute => ({
  typeLicence: 'ANNUELLE',
  plan: 'BUSINESS',
  dateDebut: jour('2026-01-01'),
  dateFin: jour('2026-12-31'),
  statut: 'ACTIVE',
  ...o,
});

describe('licence-etat', () => {
  const maintenant = new Date('2026-10-18T15:30:00Z');

  describe('calculerEtat', () => {
    it('absente quand aucune ligne de licence', () => {
      expect(calculerEtat(null, maintenant).etat).toBe('ABSENTE');
    });

    it('active avec jours restants et alerte à moins de 30 jours', () => {
      const e = calculerEtat(licence({ dateFin: jour('2026-11-10') }), maintenant);
      expect(e.etat).toBe('ACTIVE');
      expect(e.joursRestants).toBe(23);
      expect(e.bientotExpiree).toBe(true);
      const loin = calculerEtat(licence(), maintenant);
      expect(loin.joursRestants).toBe(74);
      expect(loin.bientotExpiree).toBe(false);
    });

    it('le dernier jour est encore actif (0 jour restant), le lendemain la licence est expirée', () => {
      expect(calculerEtat(licence({ dateFin: jour('2026-10-18') }), maintenant)).toMatchObject({ etat: 'ACTIVE', joursRestants: 0, bientotExpiree: true });
      expect(calculerEtat(licence({ dateFin: jour('2026-10-17') }), maintenant)).toMatchObject({ etat: 'EXPIREE', joursRestants: -1, bientotExpiree: false });
    });

    it('statuts explicites : suspendue, en attente d’activation, expirée', () => {
      expect(calculerEtat(licence({ statut: 'SUSPENDUE' }), maintenant).etat).toBe('SUSPENDUE');
      expect(calculerEtat(licence({ statut: 'EN_ATTENTE_ACTIVATION' }), maintenant).etat).toBe('EN_ATTENTE_ACTIVATION');
      expect(calculerEtat(licence({ statut: 'EXPIREE' }), maintenant).etat).toBe('EXPIREE');
    });

    it('sans date de fin : active, sans échéance', () => {
      expect(calculerEtat(licence({ dateFin: null }), maintenant)).toMatchObject({ etat: 'ACTIVE', joursRestants: null, bientotExpiree: false });
    });
  });

  describe('ajouterMois', () => {
    it('ne déborde jamais sur le mois suivant', () => {
      expect(ajouterMois(jour('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
      expect(ajouterMois(jour('2028-01-31'), 1).toISOString().slice(0, 10)).toBe('2028-02-29');
      expect(ajouterMois(jour('2026-11-30'), 3).toISOString().slice(0, 10)).toBe('2027-02-28');
    });

    it('durées standard', () => {
      expect(ajouterMois(jour('2026-10-18'), 6).toISOString().slice(0, 10)).toBe('2027-04-18');
      expect(ajouterMois(jour('2026-10-18'), 12).toISOString().slice(0, 10)).toBe('2027-10-18');
      expect(ajouterMois(jour('2026-10-18'), 24).toISOString().slice(0, 10)).toBe('2028-10-18');
    });
  });

  describe('calculerPeriode', () => {
    it('première activation : repart d’aujourd’hui', () => {
      const p = calculerPeriode('TRIMESTRIELLE', null, maintenant);
      expect(p.dateDebut.toISOString().slice(0, 10)).toBe('2026-10-18');
      expect(p.dateFin.toISOString().slice(0, 10)).toBe('2027-01-18');
    });

    it('renouvellement avant l’échéance : la période en cours est prolongée, aucun jour perdu', () => {
      const p = calculerPeriode('ANNUELLE', { dateFin: jour('2026-11-10'), statut: 'ACTIVE' }, maintenant);
      expect(p.dateFin.toISOString().slice(0, 10)).toBe('2027-11-10');
    });

    it('renouvellement après l’échéance : repart d’aujourd’hui', () => {
      const p = calculerPeriode('MENSUELLE', { dateFin: jour('2026-09-01'), statut: 'ACTIVE' }, maintenant);
      expect(p.dateFin.toISOString().slice(0, 10)).toBe('2026-11-18');
    });

    it('licence de 2 ans', () => {
      expect(calculerPeriode('BIENNALE', null, maintenant).dateFin.toISOString().slice(0, 10)).toBe('2028-10-18');
    });

    it('essai : durée fixe depuis aujourd’hui, jamais cumulé avec une licence encore valide', () => {
      const p = calculerPeriode('ESSAI', { dateFin: jour('2027-06-01'), statut: 'ACTIVE' }, maintenant);
      expect(p.dateFin.getTime() - p.dateDebut.getTime()).toBe(ESSAI_JOURS * 86_400_000);
    });
  });
});
