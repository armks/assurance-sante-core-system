import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  bornesPage,
  bornesPeriode,
  conditionRecherche,
  RecherchePeriodeQueryDto,
  versPage,
} from './pagination';

describe('pagination serveur (common/pagination)', () => {
  it('bornesPage : page 1 / 25 par défaut, offset calculé', () => {
    expect(bornesPage({})).toEqual({ page: 1, limite: 25, offset: 0 });
    expect(bornesPage({ page: 4, limite: 50 })).toEqual({ page: 4, limite: 50, offset: 150 });
  });

  it('versPage : nombre de pages calculé sur le total FILTRÉ (au moins 1)', () => {
    expect(versPage([], 0, 1, 25).pages).toBe(1);
    expect(versPage([], 210, 1, 25).pages).toBe(9);
    expect(versPage([], 200, 1, 25).pages).toBe(8);
  });

  it('bornesPeriode : du inclus dès 00:00, au inclus jusqu’à la fin du jour', () => {
    const { debut, finExclue } = bornesPeriode('2025-03-01', '2025-03-31');
    expect(debut?.toISOString()).toBe('2025-03-01T00:00:00.000Z');
    expect(finExclue?.toISOString()).toBe('2025-04-01T00:00:00.000Z');
    expect(bornesPeriode()).toEqual({ debut: undefined, finExclue: undefined });
  });

  it('DTO : page/limite convertis depuis l’URL, limite plafonnée à 100, dates ISO strictes', async () => {
    const ok = plainToInstance(RecherchePeriodeQueryDto, { page: '2', limite: '50', q: 'Échographie', du: '2025-01-01' });
    expect(await validate(ok)).toHaveLength(0);
    expect(ok.page).toBe(2);
    const ko = plainToInstance(RecherchePeriodeQueryDto, { page: '0', limite: '500', du: '15/03/2025' });
    const erreurs = (await validate(ko)).map((e) => e.property).sort();
    expect(erreurs).toEqual(['du', 'limite', 'page']);
  });

  describe('conditionRecherche', () => {
    const champs = [Prisma.sql`a.libelle`, Prisma.sql`d.numero_traitement`];

    it('sans mot → TRUE (aucun filtre)', () => {
      expect(conditionRecherche('   ', champs).sql).toBe('TRUE');
      expect(conditionRecherche(undefined, champs).sql).toBe('TRUE');
    });

    it('une condition par mot (ET), sur le texte des champs passé par sans_accent', () => {
      const c = conditionRecherche('echographie  ancienne', champs);
      expect(c.sql.match(/LIKE/g)).toHaveLength(2);
      expect(c.sql).toContain(' AND ');
      expect(c.sql).toContain("public.sans_accent(concat_ws(' ', a.libelle, d.numero_traitement))");
      expect(c.values).toEqual(['echographie', 'ancienne']); // valeurs PARAMÉTRÉES, jamais concaténées
    });

    it('caractères spéciaux de LIKE échappés, injection impossible', () => {
      const c = conditionRecherche("100% _x' OR 1=1 --", champs);
      expect(c.values).toEqual(['100\\%', '\\_x\'', 'OR', '1=1', '--']);
      expect(c.sql).not.toContain('OR 1=1');
    });
  });
});
