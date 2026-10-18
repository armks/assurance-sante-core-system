import json, re, collections, sys

d = json.load(open('dump.json', encoding='utf-8'))
CODE = re.compile(r'^[A-Z]{3,5}[0-9OIl]{3}$')
CHAP = re.compile(r'^\d{2}(\.\d{2})*$')

CHAPITRES_MED = {
    1: 'Système nerveux central, périphérique et autonome', 2: 'Œil et annexes', 3: 'Oreille', 4: 'Appareil circulatoire',
    5: 'Système immunitaire et système hématopoïétique', 6: 'Appareil respiratoire', 7: 'Appareil digestif', 8: 'Appareil urinaire et génital',
    9: 'Actes concernant la procréation, la grossesse et le nouveau-né', 10: 'Glandes endocrines et métabolisme',
    11: 'Appareil ostéoarticulaire et musculaire de la tête', 12: 'Appareil ostéoarticulaire et musculaire du cou et du tronc',
    13: 'Appareil ostéoarticulaire et musculaire du membre supérieur', 14: 'Appareil ostéoarticulaire et musculaire du membre inférieur',
    15: 'Appareil ostéoarticulaire et musculaire sans précision topographique', 16: 'Système tégumentaire - glande mammaire',
    17: 'Actes sans précision topographique', 18: 'Anesthésies complémentaires et gestes complémentaires', 19: 'Dispositions transitoires',
}
CHAPITRES_BIO = [
    "Actes d'anatomie et de cytologie pathologiques (ACP)", 'Actes de cytogénétique', 'Assistance médicale à la procréation (AMP)', 'Spermiologie',
    'Hématologie', 'Microbiologie', 'Immunologie', 'Virologie', 'Épreuves fonctionnelles', 'Hormonologie', 'Enzymologie',
    'Protéines - marqueurs tumoraux - vitamines', 'Biochimie', 'Médicaments - toxiques', 'Actes avec technique utilisant un marqueur isotopique',
    "Tests d'amplification génique et d'hybridation moléculaire (diagnostic prénatal exclu)", 'Diagnostic prénatal',
    'Diagnostic biologique des maladies héréditaires', 'Microbiologie médicale par pathologie', 'Diagnostic par tests rapides',
    'Actes divers non spécifiques en biologie',
]
DENTAIRES = {'AXI', 'DEN', 'END', 'ICO', 'IMP', 'INO', 'PAM', 'PAR', 'PDT', 'PFC', 'PFM', 'RPN', 'TDS', 'SDE'}


def nettoie(c):
    return re.sub(r'\s+', ' ', (c or '').replace('\n', ' ')).strip()


def nombre(c):
    c = nettoie(c)
    if not c:
        return None
    c = c.split('/')[0].strip()
    c = c.replace(' ', '').replace(',', '.')
    try:
        return float(c)
    except ValueError:
        return None


def garantie(partie, regroup, lettre):
    if partie == 'GEN':
        return 'CONSULTATION'
    if partie == 'INF':
        return 'SOINS_INFIRMIERS'
    if partie == 'BIO':
        return 'ANALYSES'
    reg = (regroup or '').split('/')[0].strip()
    let = (lettre or '').split('/')[0].strip()
    if let in ('D', 'DC') or reg in DENTAIRES:
        return 'DENTAIRE'
    if reg in ('ADI', 'ADE'):
        return 'IMAGERIE'
    if reg == 'ACO':
        return 'MATERNITE'
    return 'ACTE_TECHNIQUE'


actes, anomalies, variantes = [], [], []
vus = {}

def ajouter(partie, page, code, libelle, categorie, lettre, coef, regroup, brut):
    code = code.strip()
    if code in vus:
        anomalies.append({'page': page, 'code': code, 'type': 'CODE EN DOUBLE (ligne ignorée)', 'detail': f'déjà vu page {vus[code]} : {libelle[:80]}'})
        return
    vus[code] = page
    if not CODE.match(code) or re.search(r'[OIl]', code[4:]) or code[:4] != code[:4].upper():
        anomalies.append({'page': page, 'code': code, 'type': 'CODE ATYPIQUE (conservé tel qu’imprimé)', 'detail': libelle[:80]})
    actes.append({'code': code, 'libelle': libelle, 'categorie': categorie, 'lettre_cle': lettre, 'coefficient': coef, 'mode': 'ISOLE',
                  'categorie_garantie': garantie(partie, regroup, lettre), 'groupe_code': '', 'page': page, 'partie': partie})

# ---------------------------------------------------------------- partie 1 : consultations et visites (p. 7)
cat = ''
for t in d['7']['tables']:
    prev = None
    for r in t:
        r = [nettoie(c) for c in r]
        if r[0] == '' and r[1].startswith('ACTES'):
            cat = r[1].capitalize()
            continue
        if CODE.match(r[0]):
            lib = r[3] or r[4] or r[5]
            prev = {'code': r[0], 'lettre': r[2], 'lib': lib, 'cot': nombre(r[-1]), 'page': 7, 'cat': cat}
            actes_idx = len(actes)
            ajouter('GEN', 7, r[0], lib, cat, r[2], r[-1] and nombre(r[-1]), '', r)
            prev['idx'] = len(actes) - 1
        elif prev and r[0] == '' and any(r[1:]):
            suite = next((c for c in r[1:] if c), '')
            actes[prev['idx']]['libelle'] = (actes[prev['idx']]['libelle'] + ' ' + suite).replace('sage- femme', 'sage-femme')

# ---------------------------------------------------------------- partie 1 : actes infirmiers (p. 10-14)
for n in range(10, 15):
    for t in d[str(n)]['tables']:
        for r in t:
            r = [nettoie(c) for c in r]
            if len(r) >= 5 and CODE.match(r[0]):
                lettre = r[3]
                coef = nombre(r[2])
                premiere = re.split(r'\s+ou\s+', lettre)[0].strip() if lettre else ''
                if lettre and ' ou ' in lettre:
                    variantes.append({'page': n, 'code': r[0], 'detail': f'lettre-clé « {lettre} » : « {premiere} » retenue (infirmier), l’alternative n’est pas stockée'})
                if not lettre or coef is None:
                    anomalies.append({'page': n, 'code': r[0], 'type': 'COTATION INCOMPLÈTE', 'detail': r[1][:80]})
                ajouter('INF', n, r[0], r[1], 'Actes infirmiers', premiere, coef, r[4], r)
            elif len(r) >= 5 and r[0] and not r[1] and not CODE.match(r[0]) and r[0] not in ('Code',):
                pass

# ---------------------------------------------------------------- partie 2 : actes de médecine (p. 16-505)
chap = 1
for n in range(16, 506):
    for t in d[str(n)]['tables']:
        for r_brut in t:
            r = [nettoie(c) for c in r_brut]
            if not r or r[0] in ('Code', ''):
                continue
            if CHAP.match(r[0]):
                chap = int(r[0][:2])
                continue
            if re.fullmatch(r'[A-Z]{4}\s\d{3}', r[0]):
                anomalies.append({'page': n, 'code': r[0], 'type': 'CODE CORRIGÉ (espace parasite retiré)', 'detail': r[1][:80]})
                r[0] = r[0].replace(' ', '')
            if CODE.match(r[0]) or re.match(r'^[A-Z]{4}[A-Z0-9]{3}$', r[0]):
                cotation_brute = r[-1]
                brut = [(c or '') for c in r_brut]
                idx_lettre = max((i for i in range(2, len(brut) - 1) if nettoie(brut[i])), default=None)
                lettre_brute = brut[idx_lettre] if idx_lettre else ''
                idx_reg = max((i for i in range(2, (idx_lettre or 2)) if nettoie(brut[i])), default=None)
                regroup_brute = brut[idx_reg] if idx_reg else ''
                # lettres / cotations « principale » puis « avec anesthésie » : séparées par un retour à la ligne dans la cellule
                sep = lambda x: [p for p in re.split(r'[\n/]', x or '') if p.strip()]
                lettres = [re.sub(r'\s+', '', x) for x in sep(lettre_brute)]
                lettres = [('KA' if x == 'KA' else x) for x in lettres]
                regs = [re.sub(r'\s+', '', x) for x in sep(regroup_brute)] or ['']
                cots = [nombre(x) for x in sep(brut[-1])]
                coef = cots[0] if cots else None
                lettre = lettres[0] if lettres else ''
                if len(lettres) > 1 or len(cots) > 1:
                    variantes.append({'page': n, 'code': r[0], 'detail': f'principal {lettre} {cots[0]} ({regs[0]}) ; variante {"/".join(lettres[1:])} {"/".join(str(c) for c in cots[1:])} ({"/".join(regs[1:])}) non stockée'})
                if lettre not in ('K', 'KC', 'KA', 'KE', 'Z', 'D', 'DC') or coef is None:
                    anomalies.append({'page': n, 'code': r[0], 'type': 'COTATION INCOMPLÈTE', 'detail': f'{r[1][:70]} | lettre={lettre!r} cotation={cotation_brute!r}'})
                    lettre, coef = '', None
                ajouter('MED', n, r[0], r[1], f'{chap:02d} - {CHAPITRES_MED.get(chap, "")}', lettre, coef, regs[0], r)
            else:
                if any(r[1:]) and not CHAP.match(r[0]):
                    anomalies.append({'page': n, 'code': r[0], 'type': 'LIGNE NON RECONNUE (ignorée)', 'detail': ' | '.join(c for c in r if c)[:120]})

# ---------------------------------------------------------------- partie 3 : biologie (p. 506-559)
def norm(s):
    return re.sub(r'[^a-z0-9]', '', re.sub(r'[éèêë]', 'e', s.lower()))
NORM_BIO = [(norm(t), t) for t in CHAPITRES_BIO]
chapbio = CHAPITRES_BIO[0]
for n in range(506, 560):
    texte = d[str(n)]['texte']
    for ligne in texte.split('\n'):
        m = re.match(r'^\s*\d{1,2}\.?\s+(.+)$', ligne)
        if m:
            nl = norm(m.group(1))
            for nt, t in NORM_BIO:
                if nl.startswith(nt[:18]):
                    chapbio = t
    for t in d[str(n)]['tables']:
        precedent = None
        for r in t:
            r = [nettoie(c) for c in r]
            if not r or r[0] == 'Code' or (r[0] == '' and 'Code' in r[:3]):
                continue
            if CODE.match(r[0]):
                # les colonnes sont parfois décalées (cellules fusionnées) : on lit les cellules non vides — code, libellé, lettre-clé, cotation
                cellules = [c for c in r[1:] if c]
                lettre = next((c for c in cellules if re.fullmatch(r'[A-Z]{1,3}', c)), '')
                nombres = [c for c in cellules if re.fullmatch(r'[0-9][0-9 ,.]*', c)]
                coef = nombre(nombres[-1]) if nombres else None
                texte_l = [c for c in cellules if c != lettre and c not in nombres]
                lib = max(texte_l, key=len) if texte_l else ''
                if not lettre or coef is None:
                    anomalies.append({'page': n, 'code': r[0], 'type': 'COTATION INCOMPLÈTE', 'detail': f'{lib[:70]} | lettre={lettre!r} cotation={nombres!r}'})
                    lettre, coef = '', None
                ajouter('BIO', n, r[0], lib, chapbio, lettre, coef, '', r)
                precedent = len(actes) - 1 if actes and actes[-1]['code'] == r[0] else None
            elif precedent is not None and r[0] == '' and sum(1 for c in r if c) == 1:
                # suite du libellé sur la ligne suivante (ex. « Test rapide ... gorge »)
                actes[precedent]['libelle'] += ' ' + next(c for c in r if c)
            elif any(r) and not CHAP.match(r[0]) and not (r[0] == '' and len(r) > 1 and not any(r[2:])):
                anomalies.append({'page': n, 'code': r[0], 'type': 'LIGNE NON RECONNUE (ignorée)', 'detail': ' | '.join(c for c in r if c)[:120]})

json.dump({'actes': actes, 'anomalies': anomalies, 'variantes': variantes}, open('actes.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('actes', len(actes), 'anomalies', len(anomalies), 'variantes', len(variantes))
print(collections.Counter(a['partie'] for a in actes))
print('lettres', collections.Counter(a['lettre_cle'] for a in actes).most_common())
print('garanties', collections.Counter(a['categorie_garantie'] for a in actes).most_common())
print(collections.Counter(x['type'] for x in anomalies))
