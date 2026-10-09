import { BadRequestException } from '@nestjs/common';
import { lettresClesServiceDeTest } from './lettres-cles.testing';

/**
 * Cotation d'un acte (prisma/sql/080). Valeurs FICTIVES : jamais la vraie nomenclature NGAMBCI ni les
 * valeurs CMU. Un coefficient est un simple nombre ici ; aucun montant en FCFA n'intervient.
 */
describe('LettresClesService — validation de la cotation', () => {
  const service = lettresClesServiceDeTest(['KE']); // KE désactivée

  it('cotation complète valide : lettre-clé en majuscules, coefficient à 2 décimales, mode isolé par défaut', async () => {
    const { erreurs, valide } = await service.analyser({ lettreCleCode: ' kc ', coefficient: '12,5', categorieGarantie: 'Consultation' });
    expect(erreurs).toEqual([]);
    expect(valide).toEqual({ lettreCleCode: 'KC', coefficient: '12.50', modeCotation: 'ISOLE', categorieGarantie: 'CONSULTATION', groupeCode: null });
  });

  it('acte non coté (rien de renseigné) : valide, mode isolé', async () => {
    const { erreurs, valide } = await service.analyser({});
    expect(erreurs).toEqual([]);
    expect(valide).toMatchObject({ lettreCleCode: null, coefficient: null, modeCotation: 'ISOLE', groupeCode: null });
  });

  it('lettre-clé inconnue → erreur ; lettre-clé désactivée → erreur', async () => {
    expect((await service.analyser({ lettreCleCode: 'XX', coefficient: 3 })).erreurs).toEqual(['lettre-clé inconnue ou inactive (XX)']);
    expect((await service.analyser({ lettreCleCode: 'KE', coefficient: 3 })).erreurs).toEqual(['lettre-clé inconnue ou inactive (KE)']);
  });

  it('coefficient : obligatoire avec une lettre-clé, interdit sans lettre-clé', async () => {
    expect((await service.analyser({ lettreCleCode: 'B' })).erreurs).toContain('coefficient manquant (obligatoire avec une lettre-clé)');
    expect((await service.analyser({ coefficient: 4 })).erreurs).toContain('lettre-clé manquante (obligatoire avec un coefficient)');
  });

  it.each([
    ['0', 'strictement positif'],
    ['-2', 'invalide'],
    ['3.456', 'invalide'],
    ['abc', 'invalide'],
    ['100000', 'trop grand'],
  ])('coefficient « %s » refusé (%s)', async (coef, morceau) => {
    const { erreurs } = await service.analyser({ lettreCleCode: 'B', coefficient: coef });
    expect(erreurs.join(' ')).toContain(morceau);
  });

  it('mode groupé : code de groupe obligatoire ; mode isolé : code de groupe interdit', async () => {
    expect((await service.analyser({ modeCotation: 'GROUPE' })).erreurs).toContain('code de groupe manquant (obligatoire pour un acte groupé)');
    expect((await service.analyser({ modeCotation: 'ISOLE', groupeCode: 'G1' })).erreurs).toContain('code de groupe interdit pour un acte isolé');
    const ok = await service.analyser({ modeCotation: 'Groupé', groupeCode: 'fictif-g1', lettreCleCode: 'Z', coefficient: 1 });
    expect(ok.erreurs).toEqual([]);
    expect(ok.valide).toMatchObject({ modeCotation: 'GROUPE', groupeCode: 'FICTIF-G1' });
  });

  it('mode inconnu et code de groupe mal formé : erreurs', async () => {
    expect((await service.analyser({ modeCotation: 'DOUBLE' })).erreurs[0]).toContain('mode de cotation inconnu (DOUBLE)');
    expect((await service.analyser({ modeCotation: 'GROUPE', groupeCode: 'a b!' })).erreurs[0]).toContain('code de groupe invalide');
  });

  it('catégorie de garantie inconnue : erreur ; code ou libellé accepté', async () => {
    expect((await service.analyser({ categorieGarantie: 'INCONNUE' })).erreurs).toEqual(['catégorie de garantie inconnue (INCONNUE)']);
    expect((await service.analyser({ categorieGarantie: 'Analyses de laboratoire' })).valide.categorieGarantie).toBe('ANALYSES');
  });

  it('toutes les erreurs sont remontées ensemble (une ligne d’import = un rapport complet)', async () => {
    const { erreurs } = await service.analyser({ lettreCleCode: 'XX', coefficient: '-1', modeCotation: 'GROUPE', categorieGarantie: 'NOPE' });
    expect(erreurs).toHaveLength(4);
  });

  it('valider() : 400 listant toutes les erreurs ; renvoie la cotation sinon', async () => {
    await expect(service.valider({ lettreCleCode: 'B' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.valider({ lettreCleCode: 'B', coefficient: 2 })).resolves.toMatchObject({ lettreCleCode: 'B', coefficient: '2.00' });
  });
});
