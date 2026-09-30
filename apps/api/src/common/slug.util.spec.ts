import { erreurSlug, estReserve, slugDepuisNom, slugLibre } from './slug.util';

describe('slug.util — chemin de la page d’accueil d’une société', () => {
  it.each([
    ['Mutuelle Générale d’Abidjan', 'mutuelle-generale-d-abidjan'],
    ['  SAHAM Assurance CI ', 'saham-assurance-ci'],
    ['Œuvre Santé & Co.', 'oeuvre-sante-co'],
    ['Assureur Test A', 'assureur-test-a'],
    ['!!', 'organisation'],
    ['Superadmin', 'superadmin-organisation'],
    ['Dashboard Mutuelle', 'dashboard-mutuelle-organisation'],
  ])('« %s » → %s', (nom, attendu) => {
    expect(slugDepuisNom(nom)).toBe(attendu);
  });

  it('longueur bornée à 60 sans tiret final', () => {
    const s = slugDepuisNom(`${'a'.repeat(59)} b`);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith('-')).toBe(false);
  });

  it('validation : format, longueur, segments réservés', () => {
    expect(erreurSlug('ma-mutuelle')).toBeNull();
    expect(erreurSlug('Ma-Mutuelle')).toMatch(/minuscules/);
    expect(erreurSlug('ma--mutuelle')).toMatch(/tirets simples/);
    expect(erreurSlug('-mutuelle')).toMatch(/tirets simples/);
    expect(erreurSlug('a')).toMatch(/entre 2 et 60/);
    expect(erreurSlug('login')).toMatch(/réservé/);
    expect(erreurSlug('dashboard-assureur')).toMatch(/réservé/);
    expect(estReserve('reseau-de-soins')).toBe(true);
    expect(estReserve('reseau-sante')).toBe(false);
  });

  it('unicité : base, puis -2, -3…', async () => {
    const pris = new Set(['mutuelle', 'mutuelle-2']);
    expect(await slugLibre('mutuelle', async (s) => pris.has(s))).toBe('mutuelle-3');
    expect(await slugLibre('autre', async (s) => pris.has(s))).toBe('autre');
  });
});
