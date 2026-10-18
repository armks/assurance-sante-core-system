import { aAccesMessagerie, cleMois, debutDuMois, nomFichierSur, peutEcrire, refusFichier, rolesInterlocuteurs, TAILLE_MAX_FICHIER } from './messagerie-regles';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('messagerie — règles de communication', () => {
  it.each([
    ['CENTRE_MEDICAL_MEDECIN', 'ASSUREUR_EXPLOITATION', true],
    ['CENTRE_MEDICAL_ACCUEIL', 'ASSUREUR_INFORMATIQUE', true],
    ['CENTRE_MEDICAL_MEDECIN', 'ASSUREUR_COMPTABLE', false],
    ['CENTRE_MEDICAL_MEDECIN', 'PHARMACIE_PHARMACIEN', false],
    ['CENTRE_MEDICAL_MEDECIN', 'CENTRE_MEDICAL_ACCUEIL', false],
    ['PHARMACIE_PHARMACIEN', 'ASSUREUR_INFORMATIQUE', true],
    ['PHARMACIE_CAISSIERE', 'ASSUREUR_EXPLOITATION', true],
    ['PHARMACIE_PHARMACIEN', 'ASSUREUR_MEDECIN_CONSEIL', false],
    ['ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_EXPLOITATION', true],
    ['ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_PHARMACIEN_CONSEIL', true],
    ['ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_INFORMATIQUE', true],
    ['ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_COMPTABLE', false],
    ['ASSUREUR_MEDECIN_CONSEIL', 'CENTRE_MEDICAL_MEDECIN', false],
    ['ASSUREUR_COMPTABLE', 'CENTRE_MEDICAL_COMPTABLE', true],
    ['ASSUREUR_COMPTABLE', 'PHARMACIE_COMPTABLE', true],
    ['ASSUREUR_COMPTABLE', 'ASSUREUR_EXPLOITATION', true],
    ['ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE', true],
    ['ASSUREUR_COMPTABLE', 'CENTRE_MEDICAL_ACCUEIL', false],
    ['ASSUREUR_COMPTABLE', 'PHARMACIE_CAISSIERE', false],
    ['ASSUREUR_COMPTABLE', 'ASSUREUR_MEDECIN_CONSEIL', false],
    ['CENTRE_MEDICAL_COMPTABLE', 'PHARMACIE_COMPTABLE', false],
    ['ADHERENT_TITULAIRE', 'ASSUREUR_EXPLOITATION', true],
    ['SOUSCRIPTEUR_INDIVIDUEL', 'ASSUREUR_INFORMATIQUE', true],
    ['ADHERENT_TITULAIRE', 'ASSUREUR_COMPTABLE', false],
    ['ADHERENT_TITULAIRE', 'CENTRE_MEDICAL_MEDECIN', false],
    ['ADHERENT_TITULAIRE', 'ADHERENT_TITULAIRE', false],
    ['ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE', true],
    ['ASSUREUR_EXPLOITATION_CONJOINTE', 'ASSUREUR_INFORMATIQUE_ADJOINT', true],
    ['ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', false],
    ['SUPERADMIN_PRINCIPAL', 'ASSUREUR_INFORMATIQUE', false],
    ['SOCIETE_ADMINISTRATION', 'ASSUREUR_EXPLOITATION', false],
  ])('%s ↔ %s : %s', (a, b, attendu) => {
    expect(peutEcrire(a, b)).toBe(attendu);
    expect(peutEcrire(b, a)).toBe(attendu); // symétrique
  });

  it('accès à la messagerie réservé aux rôles prévus', () => {
    expect(aAccesMessagerie('ASSUREUR_INFORMATIQUE')).toBe(true);
    expect(aAccesMessagerie('ASSUREUR_DIRECTION')).toBe(false);
    expect(aAccesMessagerie(null)).toBe(false);
  });

  it('un médecin conseil ne voit que exploitation, pharmacien conseil et informatique', () => {
    expect(rolesInterlocuteurs('ASSUREUR_MEDECIN_CONSEIL').sort()).toEqual(
      ['ASSUREUR_EXPLOITATION', 'ASSUREUR_EXPLOITATION_CONJOINTE', 'ASSUREUR_INFORMATIQUE', 'ASSUREUR_INFORMATIQUE_ADJOINT', 'ASSUREUR_PHARMACIEN_CONSEIL'].sort(),
    );
  });
});

describe('messagerie — fichiers joints', () => {
  const ok = { nom: 'photo.png', type: 'image/png', taille: 1000, debut: PNG };
  it('accepte un fichier conforme', () => expect(refusFichier(ok)).toBeNull());
  it('refuse au-delà de 5 Mo', () => expect(refusFichier({ ...ok, taille: TAILLE_MAX_FICHIER + 1 })).toMatch(/volumineux/));
  it('refuse un exécutable', () => expect(refusFichier({ nom: 'virus.exe', type: 'application/x-msdownload', taille: 10, debut: Buffer.from('MZ') })).toMatch(/non autorisé/));
  it('refuse une extension qui ne correspond pas au type', () => expect(refusFichier({ ...ok, nom: 'photo.exe' })).toMatch(/extension/));
  it('refuse un contenu qui n’est pas celui annoncé (exécutable renommé en .png)', () =>
    expect(refusFichier({ ...ok, debut: Buffer.from('MZ\x90\x00\x03\x00\x00\x00') })).toMatch(/contenu/));
  it('refuse un « texte » binaire', () => expect(refusFichier({ nom: 'a.txt', type: 'text/plain', taille: 4, debut: Buffer.from([0x61, 0x00, 0x62]) })).toMatch(/binaires/));
  it('nettoie le nom : pas de chemin ni de caractères dangereux', () => {
    expect(nomFichierSur('..\\..\\etc/passwd')).toBe('passwd');
    expect(nomFichierSur('a"<b>.pdf')).toBe('ab.pdf');
    expect(nomFichierSur('')).toBe('fichier');
  });
});

describe('messagerie — purge mensuelle', () => {
  it('le 1er du mois à 00h00 la coupure est le début du mois courant', () => {
    expect(debutDuMois(new Date('2026-11-01T00:00:00Z')).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(debutDuMois(new Date('2026-10-18T15:30:00Z')).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
  it('clé de mois stable', () => {
    expect(cleMois(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11');
    expect(cleMois(new Date('2026-10-31T23:59:59Z'))).toBe('2026-10');
  });
});
