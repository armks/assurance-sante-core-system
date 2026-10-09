// Applique des migrations SQL de prisma/sql/ instruction par instruction (Prisma n'accepte pas plusieurs commandes
// dans un seul appel). Découpe sur « ; » hors blocs $$ ... $$.
//
// Usage (depuis apps/api, DATABASE_URL dans .env) :
//   node prisma/appliquer-sql.cjs 084_file_medecin_conseil_decisions.sql   # un fichier
//   node prisma/appliquer-sql.cjs --depuis 077                              # tous les fichiers >= 077, DANS L'ORDRE
//
// IMPORTANT (docs/DEPLOIEMENT.md) : les migrations sont idempotentes mais s'appliquent TOUJOURS dans l'ordre numérique.
// Plusieurs fonctions sont redéfinies par des migrations successives (CREATE OR REPLACE) : rejouer une ancienne migration
// après une plus récente ramène la fonction à une version obsolète.
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const dossier = path.join(__dirname, 'sql');
const p = new PrismaClient();

function decouper(sql) {
  const out = [];
  let cur = '';
  let dansDollar = false;
  const texte = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  for (let i = 0; i < texte.length; i++) {
    if (texte.startsWith('$$', i)) { dansDollar = !dansDollar; cur += '$$'; i++; continue; }
    if (texte[i] === ';' && !dansDollar) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += texte[i];
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((s) => !/^(BEGIN|COMMIT)$/i.test(s));
}

async function appliquer(fichier) {
  const st = decouper(fs.readFileSync(path.join(dossier, fichier), 'utf8'));
  for (const s of st) await p.$executeRawUnsafe(s);
  console.log(`${st.length} instructions appliquées : ${fichier}`);
}

(async () => {
  const args = process.argv.slice(2);
  let fichiers;
  if (args[0] === '--depuis') {
    const n = args[1];
    fichiers = fs.readdirSync(dossier).filter((f) => /^\d{3}_.*\.sql$/.test(f) && f.slice(0, 3) >= n).sort();
  } else if (args.length === 1) {
    fichiers = [args[0]];
  } else {
    console.log('Usage : node prisma/appliquer-sql.cjs <fichier.sql> | --depuis <NNN>');
    process.exit(2);
  }
  for (const f of fichiers) await appliquer(f);
  await p.$disconnect();
})().catch((e) => { console.log('ERREUR', e.message); process.exit(1); });
