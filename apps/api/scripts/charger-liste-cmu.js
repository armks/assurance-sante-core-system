/**
 * Chargement en masse de la liste des médicaments remboursables (CMU / MUGEF-CI, édition novembre 2022)
 * dans le catalogue national `referentiel_national_medicaments`.
 *
 *   node scripts/charger-liste-cmu.js            → charge (idempotent : clé = code produit)
 *   node scripts/charger-liste-cmu.js --simuler  → compte seulement ce qui serait créé / mis à jour
 *
 * Données : prisma/data/cmu-medicaments-2022-11.json, extraites du PDF officiel (736 produits). Rejouable :
 * un produit déjà chargé est mis à jour (prix, libellés), jamais dupliqué. Une seule ligne d'audit résume
 * le lot (utilisateur = le SUPERADMIN_PRINCIPAL). Réservé au catalogue national (cross-tenant).
 */
require('dotenv').config({ path: __dirname + '/../.env' });
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const SOURCE = 'MUGEF-CI / CMU — Liste des médicaments remboursables, édition novembre 2022 (10/11/2022)';
const simuler = process.argv.includes('--simuler');

/** « ALBENDAZOLE » → « Albendazole » ; « AMOXICILLINE + ACIDE CLAVULANIQUE » → « Amoxicilline + acide clavulanique ». */
const phrase = (s) => {
  const t = s.trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const prixEntier = (s) => Number(String(s).replace(/\s/g, ''));

(async () => {
  const prisma = new PrismaClient();
  const lignes = JSON.parse(fs.readFileSync(path.join(__dirname, '../prisma/data/cmu-medicaments-2022-11.json'), 'utf-8'));
  const erreurs = [];
  const produits = lignes.map((l) => {
    const prix = prixEntier(l.prix);
    if (!/^\d{9}$/.test(l.code) || !Number.isFinite(prix) || prix <= 0 || !l.dci || !l.nom || !['R', 'EP'].includes(l.categ)) erreurs.push(l);
    return {
      codeProduit: l.code,
      denominationCommune: phrase(l.dci),
      nomCommercial: l.nom.trim(),
      classeTherapeutique: phrase(l.groupe),
      prix,
      categorie: l.categ,
      regime: l.regime,
    };
  });
  if (erreurs.length) { console.error(`${erreurs.length} ligne(s) invalide(s), arrêt :`, erreurs.slice(0, 3)); process.exit(1); }
  const doublons = produits.length - new Set(produits.map((p) => p.codeProduit)).size;
  if (doublons) { console.error(`${doublons} code(s) produit en doublon dans le fichier, arrêt.`); process.exit(1); }

  const existants = new Map((await prisma.referentielNationalMedicament.findMany({
    where: { codeProduit: { in: produits.map((p) => p.codeProduit) }, deletedAt: null }, select: { id: true, codeProduit: true },
  })).map((e) => [e.codeProduit, e.id]));
  const aCreer = produits.filter((p) => !existants.has(p.codeProduit));
  const aMajorer = produits.filter((p) => existants.has(p.codeProduit));
  console.log(`${produits.length} produits dans la liste — ${aCreer.length} à créer, ${aMajorer.length} à mettre à jour (${new Set(produits.map((p) => p.denominationCommune)).size} DCI).`);
  if (simuler) { await prisma.$disconnect(); return; }

  const admin = await prisma.profil.findFirst({ where: { role: 'SUPERADMIN_PRINCIPAL', deletedAt: null }, select: { id: true } });
  if (!admin) { console.error('Aucun SUPERADMIN_PRINCIPAL : impossible de tracer le lot.'); process.exit(1); }
  const maintenant = new Date();
  const commun = (p) => ({
    denominationCommune: p.denominationCommune,
    nomCommercial: p.nomCommercial,
    classeTherapeutique: p.classeTherapeutique,
    remboursable: true,
    prixReferenceXof: p.prix,
    prixMaxRemboursable: p.prix,
    categorieRemboursement: p.categorie,
    regimeRemboursement: p.regime,
    sourceListe: SOURCE,
    statutHomologation: 'HOMOLOGUE',
  });

  await prisma.$transaction(async (tx) => {
    if (aCreer.length) {
      await tx.referentielNationalMedicament.createMany({
        data: aCreer.map((p) => ({ ...commun(p), codeProduit: p.codeProduit, homologuePar: admin.id, dateHomologation: maintenant })),
      });
    }
    for (const p of aMajorer) {
      await tx.referentielNationalMedicament.update({ where: { id: existants.get(p.codeProduit) }, data: commun(p) });
    }
    await tx.$executeRaw`SELECT log_audit(
      'CHARGEMENT_LISTE_CMU'::text, 'referentiel_national_medicaments'::text, ${admin.id}::uuid, ${admin.id}::uuid,
      ${JSON.stringify({ source: SOURCE, produits: produits.length, crees: aCreer.length, misAJour: aMajorer.length, dci: new Set(produits.map((p) => p.denominationCommune)).size })}::jsonb)`;
  }, { timeout: 120000, maxWait: 20000 });

  const total = await prisma.referentielNationalMedicament.count({ where: { sourceListe: SOURCE, deletedAt: null } });
  console.log(`Chargement terminé : ${aCreer.length} créés, ${aMajorer.length} mis à jour — ${total} produits de la liste en base.`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
