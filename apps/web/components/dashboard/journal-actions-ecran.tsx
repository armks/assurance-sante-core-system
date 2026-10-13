import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

interface LigneJournal {
  id: string;
  date: string;
  operation: 'CREATION' | 'MODIFICATION' | 'SUPPRESSION';
  table: string;
  enregistrementId: string | null;
  champsModifies: string[];
  requete: string | null;
  auteur: {
    id: string;
    email: string | null;
    pseudo: string | null;
    libelleRole: string | null;
    role: string | null;
    etablissement: string | null;
    pharmacie: string | null;
    societe: string | null;
  };
}

export interface FiltresJournalUrl {
  userId?: string;
  table?: string;
  operation?: string;
  du?: string;
  au?: string;
  page?: string;
}

const PAR_PAGE = 50;
const LIBELLE_OPERATION: Record<string, string> = { CREATION: 'Création', MODIFICATION: 'Modification', SUPPRESSION: 'Suppression' };
const TON_OPERATION: Record<string, string> = {
  CREATION: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  MODIFICATION: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  SUPPRESSION: 'bg-red-500/10 text-red-700 dark:text-red-400',
};

/** « CatalogueNationalActe » ← nom de modèle, affiché tel quel mais espacé (« Referentiel National Acte »). */
const lisible = (modele: string) => modele.replace(/([a-z])([A-Z])/g, '$1 $2');

/** Journal des actions : qui a créé / modifié / supprimé quoi, avec son rôle et sa structure au moment de l'action. */
export async function JournalActionsEcran({ base, filtres }: { base: string; filtres: FiltresJournalUrl }) {
  const page = Math.max(Number(filtres.page) || 1, 1);
  const q = new URLSearchParams({ limite: String(PAR_PAGE), decalage: String((page - 1) * PAR_PAGE) });
  for (const k of ['userId', 'table', 'operation', 'du', 'au'] as const) if (filtres[k]) q.set(k, filtres[k]!);
  const res = await apiFetch(`/api/v1/journal-actions?${q.toString()}`);
  const erreur = res.ok ? null : await messageErreur(res);
  const donnees: { total: number; lignes: LigneJournal[] } = res.ok ? await res.json() : { total: 0, lignes: [] };
  const pages = Math.max(Math.ceil(donnees.total / PAR_PAGE), 1);
  const lien = (p: number) => {
    const s = new URLSearchParams();
    for (const k of ['userId', 'table', 'operation', 'du', 'au'] as const) if (filtres[k]) s.set(k, filtres[k]!);
    s.set('page', String(p));
    return `${base}?${s.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageTitre
        titre="Journal des actions"
        description="Qui a créé, modifié ou supprimé quoi, et quand — avec le rôle et la structure de l’auteur au moment de l’action. Le journal est en ajout seul et ne conserve que les noms des champs modifiés, jamais leur contenu."
      />
      <form method="get" action={base} className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Du
          <Input type="date" name="du" defaultValue={filtres.du} className="w-40" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Au
          <Input type="date" name="au" defaultValue={filtres.au} className="w-40" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Opération
          <select name="operation" defaultValue={filtres.operation ?? ''} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground">
            <option value="">Toutes</option>
            <option value="CREATION">Créations</option>
            <option value="MODIFICATION">Modifications</option>
            <option value="SUPPRESSION">Suppressions</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Table
          <Input name="table" defaultValue={filtres.table} placeholder="Ex. Adherent" className="w-44" />
        </label>
        {filtres.userId && <input type="hidden" name="userId" value={filtres.userId} />}
        <Button type="submit" size="sm">Filtrer</Button>
        {(filtres.userId || filtres.table || filtres.operation || filtres.du || filtres.au) && (
          <Button asChild size="sm" variant="ghost"><Link href={base}>Réinitialiser</Link></Button>
        )}
      </form>

      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Auteur</th>
                  <th className="px-3 py-2">Rôle · structure</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Champs</th>
                </tr>
              </thead>
              <tbody>
                {donnees.lignes.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Aucune action enregistrée pour ces critères.</td></tr>
                )}
                {donnees.lignes.map((l) => (
                  <tr key={l.id} className="border-b last:border-0 align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{new Date(l.date).toLocaleString('fr-FR')}</td>
                    <td className="px-3 py-2">
                      <Link href={`${base}?userId=${l.auteur.id}`} className="font-medium hover:underline">
                        {l.auteur.pseudo ?? l.auteur.email ?? l.auteur.id.slice(0, 8)}
                      </Link>
                      {l.auteur.pseudo && l.auteur.email && <span className="block text-xs text-muted-foreground">{l.auteur.email}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {l.auteur.libelleRole ?? l.auteur.role ?? '—'}
                      {(l.auteur.etablissement ?? l.auteur.pharmacie ?? l.auteur.societe) && (
                        <span className="block text-muted-foreground">{l.auteur.etablissement ?? l.auteur.pharmacie ?? l.auteur.societe}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${TON_OPERATION[l.operation] ?? ''}`}>{LIBELLE_OPERATION[l.operation] ?? l.operation}</span>
                      <span className="ml-2">{lisible(l.table)}</span>
                      {l.enregistrementId && <span className="block text-xs text-muted-foreground">{l.enregistrementId}</span>}
                      {l.requete?.includes(':') && <span className="text-xs text-muted-foreground"> · {l.requete.split(':')[1]} ligne(s)</span>}
                    </td>
                    <td className="max-w-xs px-3 py-2 text-xs text-muted-foreground">{l.champsModifies.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{donnees.total} action(s) — page {page} / {pages}</span>
        <span className="flex gap-2">
          {page > 1 && <Button asChild size="sm" variant="outline"><Link href={lien(page - 1)}>Précédente</Link></Button>}
          {page < pages && <Button asChild size="sm" variant="outline"><Link href={lien(page + 1)}>Suivante</Link></Button>}
        </span>
      </div>
    </div>
  );
}
