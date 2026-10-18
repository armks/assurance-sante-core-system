import json, csv
d = json.load(open('actes.json', encoding='utf-8'))
var = {v['code'] for v in d['variantes']}
zero = []
for a in d['actes']:
    if a['code'] in var and a['libelle'].endswith(' anesthésie'):
        a['libelle'] = a['libelle'][:-len(' anesthésie')]
    if a['coefficient'] == 0:
        zero.append(a)
        a['lettre_cle'] = ''
        a['coefficient'] = None
json.dump(d, open('actes.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
from openpyxl import Workbook
wb = Workbook(); ws = wb.active; ws.title = 'Actes'
ws.append(['code', 'libelle', 'categorie', 'lettre_cle', 'coefficient', 'mode', 'categorie_garantie', 'groupe_code'])
for a in d['actes']:
    ws.append([a['code'], a['libelle'], a['categorie'], a['lettre_cle'] or None, a['coefficient'], a['mode'], a['categorie_garantie'], None])
wb.save('ngambci-catalogue-actes.xlsx')
def ecrire(nom, entetes, lignes):
    with open(nom, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f, delimiter=';'); w.writerow(entetes); w.writerows(lignes)
ecrire('rapport-anomalies.csv', ['page', 'code', 'type', 'detail'], [[x['page'], x['code'], x['type'], x['detail']] for x in d['anomalies']])
ecrire('variantes-non-stockees.csv', ['page', 'code', 'detail'], [[x['page'], x['code'], x['detail']] for x in d['variantes']])
ecrire('actes-non-tarifes-cotation-0.csv', ['page', 'code', 'libelle', 'categorie'], [[a['page'], a['code'], a['libelle'], a['categorie']] for a in zero])
print('actes', len(d['actes']), '| cotation 0 -> sans cotation', len(zero), '| avec cotation', sum(1 for a in d['actes'] if a['coefficient']))
