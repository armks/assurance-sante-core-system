// Génère le MODÈLE VIDE d'import du catalogue national des actes (NGAMBCI) : entêtes au format attendu par
// `CatalogueImportService`, AUCUNE donnée. Les valeurs officielles (codes, libellés, lettres-clés, coefficients) viennent
// UNIQUEMENT du texte officiel (décret n° 2016-865) fourni par l'assureur — rien n'est inventé ici.
//
// Usage (depuis apps/api) : node scripts/generer-modele-import-ngambci.cjs [chemin-de-sortie.xlsx]
// Sortie par défaut : ../../docs/import/ngambci-catalogue-actes-modele.xlsx
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const sortie = path.resolve(process.argv[2] ?? path.join(__dirname, '../../../docs/import/ngambci-catalogue-actes-modele.xlsx'));

(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Actes');
  ws.addRow(['code', 'libelle', 'categorie', 'lettre_cle', 'coefficient', 'mode', 'categorie_garantie', 'groupe_code']);
  ws.getRow(1).font = { bold: true };
  ws.columns = [{ width: 18 }, { width: 60 }, { width: 24 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 22 }, { width: 16 }];
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const notice = wb.addWorksheet('Notice');
  [
    ['Modèle d’import du catalogue national des actes (NGAMBCI) — VIDE'],
    [''],
    ['code', 'Obligatoire. Code officiel de l’acte (unique dans le catalogue). Ne rien inventer : le recopier du texte officiel.'],
    ['libelle', 'Obligatoire. Libellé officiel.'],
    ['categorie', 'Chapitre de la nomenclature (texte libre). Si categorie_garantie est renseignée, c’est le chapitre ; sinon la catégorie vaut aussi catégorie de garantie.'],
    ['lettre_cle', 'Lettre-clé officielle (B, Z, K, D, KA, KC, KE, P, AMI, AMK…) — doit exister et être active dans les lettres-clés du superadmin.'],
    ['coefficient', 'Coefficient officiel (nombre > 0). Obligatoire si lettre_cle est renseignée, et inversement.'],
    ['mode', 'ISOLE (défaut) ou GROUPE. GROUPE exige un groupe_code.'],
    ['categorie_garantie', 'Catégorie de garantie (CONSULTATION, ANALYSES, IMAGERIE, HOSPITALISATION…) — table categories_acte.'],
    ['groupe_code', 'Code de groupe pour les actes cotés en groupe.'],
    [''],
    ['Aucune valeur en FCFA ici : les valeurs des lettres-clés se négocient établissement par établissement, dans les conventions.'],
    ['Procédure complète : docs/CHARGEMENT-NGAMBCI.md'],
  ].forEach((l) => notice.addRow(l));
  notice.getColumn(1).width = 28;
  notice.getColumn(2).width = 110;
  notice.getRow(1).font = { bold: true };

  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  await wb.xlsx.writeFile(sortie);
  console.log('Modèle vide écrit :', sortie);
})();
