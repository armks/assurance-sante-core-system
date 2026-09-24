import { premierJourDuMois, premierJourDuMoisSuivant } from './dates.util';

describe('dates.util — coupure « 1er du mois » partagée (billing/, import-adherents/, preauthorization/)', () => {
  describe('premierJourDuMois', () => {
    it('normalise une date en milieu de mois', () => {
      expect(premierJourDuMois(new Date('2026-09-15T10:30:00Z'))).toEqual(
        new Date(Date.UTC(2026, 8, 1)),
      );
    });

    it('est idempotente sur le 1er du mois', () => {
      expect(premierJourDuMois(new Date(Date.UTC(2026, 8, 1)))).toEqual(
        new Date(Date.UTC(2026, 8, 1)),
      );
    });

    it('normalise le dernier jour du mois (fin de mois)', () => {
      expect(premierJourDuMois(new Date('2026-09-30T23:59:59Z'))).toEqual(
        new Date(Date.UTC(2026, 8, 1)),
      );
    });

    it('normalise le 29 février d’une année bissextile', () => {
      expect(premierJourDuMois(new Date('2024-02-29T12:00:00Z'))).toEqual(
        new Date(Date.UTC(2024, 1, 1)),
      );
    });

    it('normalise décembre sans changer d’année', () => {
      expect(premierJourDuMois(new Date('2026-12-25T12:00:00Z'))).toEqual(
        new Date(Date.UTC(2026, 11, 1)),
      );
    });
  });

  describe('premierJourDuMoisSuivant', () => {
    it('mois suivant en milieu d’année', () => {
      expect(premierJourDuMoisSuivant(new Date('2026-09-15T10:30:00Z'))).toEqual(
        new Date(Date.UTC(2026, 9, 1)),
      );
    });

    it('passe correctement décembre → janvier de l’année suivante', () => {
      expect(premierJourDuMoisSuivant(new Date('2026-12-10T00:00:00Z'))).toEqual(
        new Date(Date.UTC(2027, 0, 1)),
      );
    });

    it('depuis le dernier jour du mois (fin de mois)', () => {
      expect(premierJourDuMoisSuivant(new Date('2026-09-30T23:59:59Z'))).toEqual(
        new Date(Date.UTC(2026, 9, 1)),
      );
    });

    it('depuis février d’une année bissextile (29 jours)', () => {
      expect(premierJourDuMoisSuivant(new Date('2024-02-29T12:00:00Z'))).toEqual(
        new Date(Date.UTC(2024, 2, 1)),
      );
    });

    it('depuis février d’une année non bissextile (28 jours)', () => {
      expect(premierJourDuMoisSuivant(new Date('2026-02-28T12:00:00Z'))).toEqual(
        new Date(Date.UTC(2026, 2, 1)),
      );
    });

    it('sans argument, utilise la date courante', () => {
      const attendu = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));
      expect(premierJourDuMoisSuivant()).toEqual(attendu);
    });
  });
});
