"""Extraction de la « Liste des médicaments remboursables par la MUGEF-CI — édition septembre 2026 » (PDF officiel, 185 pages).

    python extraire-liste-mugef.py <liste.pdf> <dossier-de-sortie>

Sortie : medicaments.json (lignes retenues, sans doublon), doublons-ecartes.csv, corrections-manuelles.csv.
Dépendance : pdfplumber. Colonnes du PDF : CODE PRODUIT | NOM COMMERCIAL | GROUPE THERAPEUTIQUE | DCI | CATEG. | TYPE | PRIX | REGIME.
"""
import csv, json, os, re, sys
import pdfplumber

PDF, SORTIE = sys.argv[1], sys.argv[2]
os.makedirs(SORTIE, exist_ok=True)

# Lignes dont la DCI, trop longue, déborde sur la colonne CATEG. dans le PDF (les caractères se mélangent à la lecture) :
# valeurs relevées à la main sur le PDF (catégorie R, type G pour toutes).
CORRECTIONS = {
    '8393542': ("ACETATE D'HYDROCORTISONE + LIDOCAINE + OXYDE DE ZINC + ALLANTOINE", 'R', 'G'),
    '2269574': ('CHLORPHENIRAMINE+DEXTROMETORPHANE+PHENYLEPHRINE', 'R', 'G'),
    '8016489': ('PARACETAMOL+DEXTROMETORPHANE+PSEUDOEPHEDRINE', 'R', 'G'),
    '3249512': ('CHLORPHENIRAMINE+DEXTROMETORPHANE+PHENYLEPHRINE', 'R', 'G'),
    '2029634': ('PARACETAMOL+CHLORPHENIRAMINE+CAFEINE+PHENYLPROPANOLAMINE', 'R', 'G'),
    '5804010': ('PARACETAMOL+CHLORPHENIRAMINE+DEXTROMETORPHANE+PSEUDOEPHEDRINE', 'R', 'G'),
    '3350553': ('CHLORPHENIRAMINE+DEXTROMETORPHANE+PHENYLEPHRINE', 'R', 'G'),
    '2475214': ('SIMETHICONE+ALUMINIUM HYDROXYDE+MAGNESIUM HYDROXYDE', 'R', 'G'),
    '2026854': ('EUCALYPTUS+GAIACOL+LAVANDE+MENTHOL+TEREBENTINE', 'R', 'G'),
}
NETTOYAGE = str.maketrans({'\u2212': '-', '\u2019': "'", '\u00bf': '\u00b5'})  # « − » → « - », « ’ » → « ' », « ¿G » → « µG »
net = lambda s: re.sub(r'\s+', ' ', (s or '').replace('\n', ' ').translate(NETTOYAGE)).strip()

brut = []
with pdfplumber.open(PDF) as pdf:
    for i, pg in enumerate(pdf.pages, 1):
        for t in pg.extract_tables():
            if not t or len(t[0]) != 8:
                continue
            for r in t:
                r = [net(c) for c in r]
                if r[0].startswith('CODE') or not r[0]:
                    continue
                brut.append(dict(page=i, code=r[0], nom=r[1], groupe=r[2], dci=r[3], categ=r[4], type=r[5], prix=r[6], regime=r[7]))

corriges = []
for r in brut:
    if r['code'] in CORRECTIONS:
        avant = dict(r)
        r['dci'], r['categ'], r['type'] = CORRECTIONS[r['code']]
        corriges.append(avant)
    r['prix'] = int(r['prix'].replace(' ', '')) if re.fullmatch(r'\d[\d ]*', r['prix']) else None

invalides = [r for r in brut if not (re.fullmatch(r'\d{6,7}', r['code']) and r['prix'] and r['nom'] and r['dci'] and r['categ'] in ('R', 'EP', 'EPF', 'TPC', 'libre') and r['type'] in ('G', 'S') and r['regime'] in ('RCO', 'IVSPL'))]
if invalides:
    print('lignes invalides :', invalides[:5]); sys.exit(1)

# Doublons : même code (aucun) ou mêmes nom, DCI, groupe, catégorie, type, prix et régime sous deux codes → première occurrence gardée.
vus_code, vus_cle, retenus, ecartes = {}, {}, [], []
for r in brut:
    cle = tuple(re.sub(r'\s+', ' ', str(r[k]).upper()) for k in ('nom', 'dci', 'groupe', 'categ', 'type', 'prix', 'regime'))
    if r['code'] in vus_code or cle in vus_cle:
        ecartes.append((r, vus_code.get(r['code']) or vus_cle[cle]))
        continue
    vus_code[r['code']] = r; vus_cle[cle] = r; retenus.append(r)

json.dump(retenus, open(os.path.join(SORTIE, 'medicaments.json'), 'w', encoding='utf-8'), ensure_ascii=False)
with open(os.path.join(SORTIE, 'doublons-ecartes.csv'), 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f, delimiter=';'); w.writerow(['page', 'code écarté', 'code conservé', 'nom commercial', 'DCI', 'prix'])
    for r, k in ecartes: w.writerow([r['page'], r['code'], k['code'], r['nom'], r['dci'], r['prix']])
with open(os.path.join(SORTIE, 'corrections-manuelles.csv'), 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f, delimiter=';'); w.writerow(['page', 'code', 'nom commercial', 'DCI lue', 'catégorie lue', 'type lu'])
    for r in corriges: w.writerow([r['page'], r['code'], r['nom'], r['dci'], r['categ'], r['type']])
print(f'{len(brut)} lignes lues, {len(retenus)} retenues, {len(ecartes)} doublons écartés, {len(corriges)} lignes corrigées à la main')
