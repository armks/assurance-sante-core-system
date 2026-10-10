// Retire les données FICTIVES du barème avant le chargement des données officielles (NGAMBCI).
//
//   node scripts/retirer-donnees-fictives.cjs              # SIMULATION (par défaut) : liste ce qui serait retiré
//   node scripts/retirer-donnees-fictives.cjs --appliquer  # applique, dans UNE transaction, en ordre inverse des dépendances
//
// Ce qui est retiré (seulement s'il n'est référencé par AUCUNE donnée non fictive) :
//   - actes du catalogue national dont le code commence par « FICT » ou dont le libellé contient « (fictif) » ;
//   - actes du référentiel d'une organisation de même nature, sans acte de dossier ni tarif / exception de convention ;
//   - conventions dont le numéro commence par « FICT », UNIQUEMENT proposées ou refusées (une convention validée ne se supprime
//     jamais : elle s'archive, voir docs/DEPLOIEMENT.md), avec leurs valeurs et exceptions.
// Ce qui est SEULEMENT signalé (jamais retiré par ce script) : les lettres-clés dont le libellé porte « (fictif) » — elles servent
// de clé étrangère partout ; le superadmin remplace leur libellé par le libellé officiel (écran « Lettres-clés »).
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const appliquer = process.argv.includes('--appliquer');

const FICTIF_NATIONAL = `(code ILIKE 'FICT%' OR libelle ILIKE '%(fictif)%')`;

(async () => {
  const lettres = await p.$queryRawUnsafe(`SELECT code, libelle FROM lettres_cles WHERE libelle ILIKE '%(fictif)%' ORDER BY code`);
  const nationaux = await p.$queryRawUnsafe(`SELECT id, code FROM referentiel_national_actes WHERE deleted_at IS NULL AND ${FICTIF_NATIONAL}`);
  const conventions = await p.$queryRawUnsafe(`SELECT id, numero, version, statut FROM conventions WHERE deleted_at IS NULL AND numero ILIKE 'FICT%' ORDER BY numero, version`);
  const convRetirables = conventions.filter((c) => ['PROPOSEE', 'REFUSEE'].includes(c.statut));
  const convConservees = conventions.filter((c) => !convRetirables.includes(c));
  // les exceptions portées par les conventions qu'on retire ne comptent pas comme références
  const exclues = convRetirables.length ? convRetirables.map((c) => `'${c.id}'::uuid`).join(',') : `'00000000-0000-0000-0000-000000000000'::uuid`;
  const actesOrg = await p.$queryRawUnsafe(`
    SELECT ra.id, ra.code,
           (SELECT count(*)::int FROM actes_dossier ad WHERE ad.referentiel_acte_id = ra.id) AS dossiers,
           (SELECT count(*)::int FROM convention_actes ca WHERE ca.referentiel_acte_id = ra.id AND ca.convention_id NOT IN (${exclues})) AS exceptions,
           (SELECT count(*)::int FROM tarifs_conventionnes tc WHERE tc.referentiel_acte_id = ra.id) AS tarifs
      FROM referentiel_actes ra
     WHERE ra.deleted_at IS NULL AND ${FICTIF_NATIONAL.replace(/code/g, 'ra.code').replace(/libelle/g, 'ra.libelle')}`);

  const actesLibres = actesOrg.filter((a) => a.dossiers === 0 && a.exceptions === 0 && a.tarifs === 0);
  const actesRetenus = actesOrg.filter((a) => !actesLibres.includes(a));

  console.log(appliquer ? '=== APPLICATION ===' : '=== SIMULATION (rien n’est modifié) ===');
  console.log(`Lettres-clés au libellé « (fictif) » (à remplacer par le superadmin, NON retirées) : ${lettres.map((l) => l.code).join(', ') || 'aucune'}`);
  console.log(`Catalogue national — actes fictifs à retirer : ${nationaux.length}`);
  console.log(`Référentiel d’organisation — actes fictifs retirables : ${actesLibres.length} ; conservés car référencés : ${actesRetenus.length}`);
  for (const a of actesRetenus) console.log(`   conservé ${a.code} (actes de dossier ${a.dossiers}, exceptions ${a.exceptions}, tarifs ${a.tarifs})`);
  console.log(`Conventions fictives retirables (proposées / refusées) : ${convRetirables.length} ; conservées (validées / archivées) : ${convConservees.length}`);
  for (const c of convConservees) console.log(`   conservée ${c.numero} v${c.version} (${c.statut}) — à archiver, jamais supprimer`);

  if (!appliquer) {
    console.log('\nPour appliquer : node scripts/retirer-donnees-fictives.cjs --appliquer');
    await p.$disconnect();
    return;
  }
  await p.$transaction(async (tx) => {
    const ids = (l) => l.map((x) => `'${x.id}'::uuid`).join(',');
    if (convRetirables.length) {
      await tx.$executeRawUnsafe(`UPDATE conventions SET convention_precedente_id = NULL WHERE convention_precedente_id IN (${ids(convRetirables)})`);
      await tx.$executeRawUnsafe(`DELETE FROM convention_actes WHERE convention_id IN (${ids(convRetirables)})`);
      await tx.$executeRawUnsafe(`DELETE FROM convention_valeurs WHERE convention_id IN (${ids(convRetirables)})`);
      await tx.$executeRawUnsafe(`DELETE FROM conventions WHERE id IN (${ids(convRetirables)})`);
    }
    if (actesLibres.length) await tx.$executeRawUnsafe(`DELETE FROM referentiel_actes WHERE id IN (${ids(actesLibres)})`);
    if (nationaux.length) await tx.$executeRawUnsafe(`DELETE FROM referentiel_national_actes WHERE id IN (${ids(nationaux)})`);
  });
  console.log('Retrait appliqué (une transaction).');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERREUR', e.message);
  await p.$disconnect();
  process.exit(1);
});
