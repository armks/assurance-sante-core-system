import Link from 'next/link';

export const francs = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} F`;
export const nombre = (n: number) => n.toLocaleString('fr-FR');
export const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const CHAMP = 'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';
export const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground';

export function periodesRapides() {
  const n = new Date();
  const a = n.getUTCFullYear();
  const m = n.getUTCMonth();
  const mois = (annee: number, index: number) => ({ du: iso(new Date(Date.UTC(annee, index, 1))), au: iso(new Date(Date.UTC(annee, index + 1, 0))) });
  return [
    { libelle: 'Ce mois', ...mois(a, m) },
    { libelle: 'Mois dernier', ...mois(m === 0 ? a - 1 : a, (m + 11) % 12) },
    { libelle: '3 derniers mois', du: iso(new Date(Date.UTC(a, m - 2, 1))), au: iso(new Date(Date.UTC(a, m + 1, 0))) },
    { libelle: 'Cette année', du: `${a}-01-01`, au: `${a}-12-31` },
  ];
}

export function Tableau({ titre, colonnes, lignes, vide }: { titre: string; colonnes: string[]; lignes: React.ReactNode[][]; vide?: string }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{titre}</h2>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              {colonnes.map((c, i) => (
                <th key={c} className={`${TH} ${i > 0 ? 'text-right' : ''}`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lignes.length === 0 ? (
              <tr>
                <td colSpan={colonnes.length} className="px-3 py-4 text-center text-muted-foreground">
                  {vide ?? 'Aucune donnée pour ces critères.'}
                </td>
              </tr>
            ) : (
              lignes.map((l, r) => (
                <tr key={r} className="border-t">
                  {l.map((c, i) => (
                    <td key={i} className={`px-3 py-2 ${i > 0 ? 'text-right tabular-nums' : ''}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

