/**
 * Chargement de la liste des médicaments remboursables (MUGEF-CI, édition septembre 2026) dans le catalogue national
 * `referentiel_national_medicaments`.
 *
 *   node scripts/charger-liste-mugef.js            → charge (idempotent : clé = code produit)
 *   node scripts/charger-liste-mugef.js --simuler  → compte seulement ce qui serait créé / mis à jour
 *
 * Données : prisma/data/mugef-medicaments-2026-09.json, produites par scripts/medicaments/extraire-liste-mugef.py à partir du PDF
 * officiel (colonnes : code produit, nom commercial, groupe thérapeutique, DCI, catégorie, type G/S, prix, régime). Rejouable :
 * un produit déjà chargé est mis à jour, jamais dupliqué. Une ligne d'audit résume le lot. Réservé au catalogue national.
 */
require('dotenv').config({ path: __dirname + '/../.env' });
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const SOURCE = 'MUGEF-CI — Liste des médicaments remboursables, édition septembre 2026 (08/09/2026)';
const simuler = process.argv.includes('--simuler');

/** « ALBENDAZOLE » → « Albendazole » ; « AMOXICILLINE + ACIDE CLAVULANIQUE » → « Amoxicilline + acide clavulanique ». */
const phrase = (s) => {
  const t = s.trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

(async () => {
  const prisma = new PrismaClient();
  const lignes = JSON.parse(fs.readFileSync(path.join(__dirname, '../prisma/data/mugef-medicaments-2026-09.json'), 'utf-8'));
  const produits = lignes.map((l) => ({
    codeProduit: l.code,
    nomCommercial: l.nom,
    classeTherapeutique: phrase(l.groupe),
    denominationCommune: phrase(l.dci),
    categorie: l.categ === 'libre' ? 'LIBRE' : l.categ,
    type: l.type,
    prix: l.prix,
    regime: l.regime,
  }));
  const invalides = produits.filter((p) => !/^\d{6,7}$/.test(p.codeProduit) || !(p.prix > 0) || !p.denominationCommune || !p.nomCommercial);
  if (invalides.length) { console.error(`${invalides.length} ligne(s) invalide(s), arrêt :`, invalides.slice(0, 3)); process.exit(1); }
  if (new Set(produits.map((p) => p.codeProduit)).size !== produits.length) { console.error('Codes produit en doublon, arrêt.'); process.exit(1); }

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
    // le prix de la liste ne sert QU'AUX ALERTES de majoration du comptoir : aucun plafond de remboursement
    prixMaxRemboursable: null,
    categorieRemboursement: p.categorie,
    regimeRemboursement: p.regime,
    typeMedicament: p.type,
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
      'CHARGEMENT_LISTE_MUGEF'::text, 'referentiel_national_medicaments'::text, ${admin.id}::uuid, ${admin.id}::uuid,
      ${JSON.stringify({ source: SOURCE, produits: produits.length, crees: aCreer.length, misAJour: aMajorer.length, dci: new Set(produits.map((p) => p.denominationCommune)).size })}::jsonb)`;
  }, { timeout: 120000, maxWait: 20000 });

  const total = await prisma.referentielNationalMedicament.count({ where: { sourceListe: SOURCE, deletedAt: null } });
  console.log(`Chargement terminé : ${aCreer.length} créés, ${aMajorer.length} mis à jour — ${total} produits de la liste en base.`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
