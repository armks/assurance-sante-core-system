// Met à jour le mot de passe dans DATABASE_URL et DIRECT_URL de apps/api/.env
// SANS afficher la valeur. Usage :
//   node apps/api/scripts/maj-mdp-db.mjs                 (lit le mdp sur stdin, sans écho)
//   NEW_DB_PASSWORD=... node apps/api/scripts/maj-mdp-db.mjs
//   node apps/api/scripts/maj-mdp-db.mjs --fichier chemin/vers/mdp.txt
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const ENV = path.join(import.meta.dirname, '..', '.env');

function reecrire(motDePasse) {
  const mdp = motDePasse.trim();
  if (!mdp) {
    console.error('Mot de passe vide — abandon.');
    process.exit(1);
  }
  const enc = encodeURIComponent(mdp);
  let contenu = fs.readFileSync(ENV, 'utf8');
  let n = 0;
  contenu = contenu.replace(
    /^(DATABASE_URL="postgresql:\/\/[^:]+:)[^@]+(@.*)$/m,
    (_, a, b) => (n++, `${a}${enc}${b}`),
  );
  contenu = contenu.replace(
    /^(DIRECT_URL="postgresql:\/\/[^:]+:)[^@]+(@.*)$/m,
    (_, a, b) => (n++, `${a}${enc}${b}`),
  );
  if (n !== 2) {
    console.error(
      `Attendu 2 remplacements (DATABASE_URL + DIRECT_URL), obtenu ${n}. Rien écrit.`,
    );
    process.exit(1);
  }
  fs.writeFileSync(ENV, contenu);
  console.log('apps/api/.env : DATABASE_URL et DIRECT_URL mis à jour (valeur non affichée).');
  console.log('Vérifiez : npx prisma db execute --stdin  <<< "select 1;"');
}

const iFichier = process.argv.indexOf('--fichier');
if (process.env.NEW_DB_PASSWORD) {
  reecrire(process.env.NEW_DB_PASSWORD);
} else if (iFichier !== -1 && process.argv[iFichier + 1]) {
  reecrire(fs.readFileSync(process.argv[iFichier + 1], 'utf8'));
} else {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  let buf = '';
  rl.on('line', (l) => (buf += l));
  rl.on('close', () => reecrire(buf));
}
