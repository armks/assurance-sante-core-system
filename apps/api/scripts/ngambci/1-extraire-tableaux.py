import pdfplumber, json, sys
PDF = r'C:\Users\armel\Downloads\766098776-NGAMBCI-d-cembre2019-1.pdf'
out = {}
with pdfplumber.open(PDF) as pdf:
    for i, p in enumerate(pdf.pages, 1):
        try:
            tabs = p.extract_tables()
        except Exception as e:
            tabs = [[['ERREUR', str(e)]]]
        out[i] = {'tables': tabs, 'texte': p.extract_text() or ''}
        if i % 50 == 0:
            print('page', i, flush=True)
json.dump(out, open('dump.json', 'w', encoding='utf-8'), ensure_ascii=False)
print('termine', len(out))
