'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { changerPoliceEnMasse } from '@/app/dashboard-assureur/adherents-actions';
import type { AdherentListe, PoliceRef } from '@/components/dashboard/adherents/types';
import { ChampSelect, FormulaireModal } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const PAS = 50;
const libellePolice = (p: PoliceRef) => `${p.numeroPolice}${p.produit ? ` — ${p.produit.nom}` : ''} (${p.statut})`;
const norme = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * « Changer la police en masse » : on choisit la police d'origine, puis on TRIE la liste de ses adhérents (recherche par nom,
 * prénom, n° de carte ou d'adhérent) et on coche / décoche par lot (« les N résultats ») ou à l'unité. La sélection est conservée
 * quand la recherche change ; le compteur indique toujours le total réellement sélectionné. Les bénéficiaires suivent leur
 * titulaire. Seuls les adhérents cochés sont rattachés à la police active choisie.
 */
export function ChangerPoliceMasse({ adherents, polices }: { adherents: AdherentListe[]; polices: PoliceRef[] }) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState('');
  const [cibleId, setCibleId] = useState('');
  const [q, setQ] = useState('');
  const [limite, setLimite] = useState(PAS);
  const [coches, setCoches] = useState<Set<string>>(new Set());

  const source = polices.find((p) => p.id === sourceId);
  const cibles = polices.filter((p) => p.statut === 'ACTIVE' && source && p.souscripteurId === source.souscripteurId && p.id !== source.id);
  const sources = polices.filter((p) => adherents.some((a) => a.police?.id === p.id && a.statut !== 'RADIE'));
  const concernes = useMemo(
    () =>
      adherents
        .filter((a) => a.police?.id === sourceId && a.statut !== 'RADIE')
        .sort((a, b) => `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, 'fr')),
    [adherents, sourceId],
  );
  const filtres = useMemo(() => {
    const mot = norme(q.trim());
    if (!mot) return concernes;
    return concernes.filter((a) => norme(`${a.nom} ${a.prenom} ${a.numeroCarte} ${a.numeroAdherent}`).includes(mot));
  }, [concernes, q]);
  const affiches = filtres.slice(0, limite);
  const nbBeneficiaires = concernes.filter((a) => coches.has(a.id)).reduce((n, a) => n + (a._count?.beneficiaires ?? 0), 0);
  const tousFiltresCoches = filtres.length > 0 && filtres.every((a) => coches.has(a.id));

  const choisirSource = (id: string) => {
    setSourceId(id);
    setCibleId('');
    setQ('');
    setLimite(PAS);
    // par défaut toute la police est cochée : on décoche ensuite les exceptions
    setCoches(new Set(adherents.filter((a) => a.police?.id === id && a.statut !== 'RADIE').map((a) => a.id)));
  };
  const basculer = (id: string) =>
    setCoches((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const lot = (cocher: boolean) =>
    setCoches((c) => {
      const n = new Set(c);
      for (const a of filtres) {
        if (cocher) n.add(a.id);
        else n.delete(a.id);
      }
      return n;
    });

  return (
    <FormulaireModal
      titre="Changer la police en masse"
      description="Choisissez la police d’origine, triez la liste, cochez les adhérents à rattacher (leurs bénéficiaires suivent), puis la nouvelle police active."
      declencheur={
        <Button size="sm" variant="outline">
          Changer la police en masse
        </Button>
      }
      libelleSoumettre={coches.size > 0 ? `Rattacher ${coches.size} adhérent(s)` : 'Rattacher'}
      onSoumettre={async () => {
        const ids = concernes.filter((a) => coches.has(a.id)).map((a) => a.id);
        if (ids.length === 0) return { ok: false, error: 'Cochez au moins un adhérent.' };
        return changerPoliceEnMasse({ policeSourceId: sourceId, policeCibleId: cibleId, adherentIds: ids });
      }}
      onSucces={() => {
        setSourceId('');
        setCibleId('');
        setQ('');
        setCoches(new Set());
        router.refresh();
      }}
    >
      <ChampSelect
        name="policeSourceId"
        label="1. Police d’origine"
        required
        placeholder="Choisir la police actuelle…"
        value={sourceId}
        onChange={(e) => choisirSource(e.target.value)}
        options={sources.map((p) => ({ valeur: p.id, libelle: libellePolice(p) }))}
      />

      {source && (
        <div className="space-y-2">
          <p className="text-sm font-medium">2. Adhérents à rattacher</p>
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimite(PAS);
            }}
            placeholder="Rechercher : nom, prénom, n° de carte…"
            aria-label="Rechercher un adhérent"
            className="h-9"
          />
          <div className="flex flex-wrap items-center justify-between gap-1 text-sm">
            <span className="text-muted-foreground">
              <strong className="text-foreground">{coches.size}</strong> sélectionné(s) sur {concernes.length}
              {nbBeneficiaires > 0 ? ` · ${nbBeneficiaires} bénéficiaire(s) suivront` : ''}
              {q.trim() ? ` · ${filtres.length} résultat(s)` : ''}
            </span>
            <span className="flex gap-1">
              <Button type="button" size="xs" variant="ghost" disabled={filtres.length === 0 || tousFiltresCoches} onClick={() => lot(true)}>
                {q.trim() ? `Cocher les ${filtres.length} résultats` : 'Tout cocher'}
              </Button>
              <Button type="button" size="xs" variant="ghost" disabled={filtres.length === 0} onClick={() => lot(false)}>
                {q.trim() ? `Décocher les ${filtres.length} résultats` : 'Tout décocher'}
              </Button>
            </span>
          </div>
          <ul className="max-h-[45vh] divide-y overflow-y-auto rounded-md border text-sm">
            {affiches.map((a) => (
              <li key={a.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-muted/50">
                  <input type="checkbox" checked={coches.has(a.id)} onChange={() => basculer(a.id)} />
                  <span className="font-medium">
                    {a.nom} {a.prenom}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{a.numeroCarte}</span>
                  {(a._count?.beneficiaires ?? 0) > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground">+{a._count?.beneficiaires} bénéf.</span>
                  )}
                </label>
              </li>
            ))}
            {affiches.length === 0 && <li className="px-3 py-3 text-muted-foreground">Aucun adhérent ne correspond.</li>}
          </ul>
          {filtres.length > affiches.length && (
            <Button type="button" size="xs" variant="outline" onClick={() => setLimite((l) => l + PAS)}>
              Afficher {Math.min(PAS, filtres.length - affiches.length)} de plus ({filtres.length - affiches.length} restants)
            </Button>
          )}
        </div>
      )}

      {source && (
        <ChampSelect
          name="policeCibleId"
          label="3. Nouvelle police (active)"
          required
          placeholder={cibles.length === 0 ? 'Aucune police active pour cette société' : 'Choisir la nouvelle police…'}
          value={cibleId}
          onChange={(e) => setCibleId(e.target.value)}
          options={cibles.map((p) => ({ valeur: p.id, libelle: libellePolice(p) }))}
        />
      )}
    </FormulaireModal>
  );
}
