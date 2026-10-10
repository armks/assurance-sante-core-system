// Supprime UNE organisation de TEST (reste d'un script interrompu) avec ses profils, comptes Auth et documents, en ordre
// inverse des dépendances. Par défaut : inventaire seulement.
//   node scripts/nettoyer-organisation-test.cjs <organisation_id>              # inventaire
//   node scripts/nettoyer-organisation-test.cjs <organisation_id> --supprimer  # suppression
// Refuse les organisations d'amorçage (slug assureur-test-a / assureur-test-b).
const { PrismaClient } = require('@prisma/client');
const { createClient } = require('@supabase/supabase-js');

(async () => {
  const p = new PrismaClient();
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const orgId = process.argv[2];
  const supprimer = process.argv.includes('--supprimer');
  if (!orgId) { console.log('Usage : node scripts/nettoyer-organisation-test.cjs <organisation_id> [--supprimer]'); process.exit(2); }
  const o = `'${orgId}'::uuid`;
  const [org] = await p.$queryRawUnsafe(`select slug from organisations where id = ${o}`);
  if (!org) { console.log('Organisation introuvable.'); process.exit(1); }
  if (/^assureur-test-[ab]$/.test(org.slug)) { console.log('Organisation d’amorçage : refus.'); process.exit(1); }
  const tables = await p.$queryRawUnsafe(`select table_name from information_schema.columns where table_schema='public' and column_name='organisation_id' order by 1`);
  const inventaire = [];
  for (const t of tables) {
    const r = await p.$queryRawUnsafe(`select count(*)::int n from public."${t.table_name}" where organisation_id = ${o}`).catch(() => [{ n: -1 }]);
    if (r[0].n !== 0) inventaire.push(`${t.table_name}=${r[0].n}`);
  }
  const profils = await p.$queryRawUnsafe(`select id, role from profils where organisation_id = ${o}`);
  console.log(`Organisation ${org.slug}\n  lignes : ${inventaire.join(', ') || 'aucune'}\n  profils : ${profils.map((x) => x.role).join(', ') || 'aucun'}`);
  if (!supprimer) { await p.$disconnect(); return; }

  const us = `ARRAY[${profils.map((x) => `'${x.id}'::uuid`).join(',') || "'00000000-0000-0000-0000-000000000000'::uuid"}]`;
  const dos = `(select id from dossiers_soins where organisation_id = ${o})`;
  const conv = `(select id from conventions where organisation_id = ${o})`;
  const stmts = [
    `update tarifs_proposes set ligne_facturation_id = null, ajout_convention_id = null where organisation_id = ${o}`,
    `update lignes_facturation set tarif_propose_id = null, facture_mensuelle_etablissement_id = null where organisation_id = ${o}`,
    `delete from factures_dossier where tarif_propose_id in (select id from tarifs_proposes where organisation_id = ${o})`,
    `delete from remboursements where reclamation_id in (select id from reclamations where organisation_id = ${o})`,
    `delete from reclamations where organisation_id = ${o}`,
    `delete from lignes_facturation where organisation_id = ${o}`, `delete from tarifs_proposes where organisation_id = ${o}`,
    `delete from mouvements_financiers where organisation_id = ${o}`, `delete from paiements_groupes where organisation_id = ${o}`,
    `delete from factures_mensuelles_etablissement where organisation_id = ${o}`, `delete from comptes_financiers where organisation_id = ${o}`,
    `delete from factures_dossier where organisation_id = ${o}`, `delete from contestations_acte where organisation_id = ${o}`,
    `delete from actes_dossier where dossier_soins_id in ${dos}`, `delete from consultations_dossier where dossier_soins_id in ${dos}`,
    `delete from tickets_soins where organisation_id = ${o}`, `delete from dossiers_soins where organisation_id = ${o}`,
    `delete from audit_log where organisation_id = ${o} or user_id = ANY(${us})`,
    `delete from convention_actes where convention_id in ${conv}`, `delete from convention_valeurs where convention_id in ${conv}`,
    `update conventions set convention_precedente_id = null where organisation_id = ${o}`,
    `delete from tarifs_conventionnes where organisation_id = ${o}`, `delete from conventions where organisation_id = ${o}`,
    `delete from referentiel_actes where organisation_id = ${o}`,
    `delete from beneficiaires where adherent_id in (select id from adherents where organisation_id = ${o})`,
    `delete from profils where id = ANY(${us})`, `delete from adherents where organisation_id = ${o}`, `delete from polices where organisation_id = ${o}`,
    `delete from garanties where produit_id in (select id from produits where organisation_id = ${o})`, `delete from produits where organisation_id = ${o}`,
    `delete from etablissements_sante where organisation_id = ${o}`, `delete from pharmacies where organisation_id = ${o}`,
    `delete from souscripteurs where organisation_id = ${o}`, `delete from organisations where id = ${o}`,
  ];
  let derniere = null;
  for (let passe = 1; passe <= 6; passe++) {
    let erreurs = 0;
    for (const s of stmts) { try { await p.$executeRawUnsafe(s); } catch (x) { erreurs++; derniere = `${s.slice(0, 70)} → ${x.message.split('\n').pop().slice(0, 100)}`; } }
    if (!erreurs) { derniere = null; break; }
  }
  try {
    const { data: ds } = await admin.storage.from('conventions').list(orgId);
    for (const d of ds || []) {
      const { data: f } = await admin.storage.from('conventions').list(`${orgId}/${d.name}`);
      const c = (f || []).map((x) => `${orgId}/${d.name}/${x.name}`);
      if (c.length) await admin.storage.from('conventions').remove(c);
    }
  } catch { /* stockage indisponible : signalé par l'inventaire final */ }
  for (const x of profils) await admin.auth.admin.deleteUser(x.id).catch(() => undefined);
  const reste = await p.$queryRawUnsafe(`select count(*)::int n from organisations where id = ${o}`);
  console.log(reste[0].n === 0 ? 'Organisation supprimée.' : `RESTE : ${derniere}`);
  await p.$disconnect();
})();
