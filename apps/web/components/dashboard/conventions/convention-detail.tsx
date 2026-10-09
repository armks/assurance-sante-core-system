'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { verifierAction } from '@/app/dependances-actions';
import {
  archiverConvention,
  enregistrerActes,
  enregistrerValeurs,
  joindreDocument,
  modifierConvention,
  nouvelleVersion,
  refuserConvention,
  reproposerConvention,
  supprimerConvention,
  urlDocument,
  validerConvention,
} from '@/app/dashboard-assureur/conventions-actions';
import {
  Alerte,
  ChampSelect,
  ChampTexte,
  ConfirmationAction,
  FormulaireModal,
  StatutBadge,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  LIBELLE_CONTEXTE_CONVENTION,
  LIBELLE_POLITIQUE_DEPASSEMENT,
  LIBELLE_ROLE_ACTEUR,
  LIBELLE_STATUT_CONVENTION,
  TON_STATUT_CONVENTION,
  type ActeurConvention,
  type ConventionDetail,
  type LettreCleActive,
} from '@/lib/conventions';
import { dateFr } from '@/lib/format';

const CONTEXTES = ['AMBULATOIRE', 'HOSPITALISATION'] as const;

interface LigneActe {
  referentielActeId: string;
  code: string;
  libelle: string;
  lettreCleCode: string | null;
  mode: 'FORFAIT' | 'VALEUR';
  montant: string;
}

const acteur = (a: ActeurConvention | null) =>
  a ? LIBELLE_ROLE_ACTEUR[a.role ?? ''] ?? a.role ?? 'Compte inconnu' : '—';

/**
 * Formulaire UNIQUE d'une convention : lettres-clés en lignes, valeurs en colonnes (ambulatoire /
 * hospitalisation), exceptions par acte, document signé, circuit de validation. Modifiable tant que la
 * convention est « proposée » ; ensuite : nouvelle version.
 */
export function ConventionDetailEcran({
  convention: c,
  lettres,
  actesReferentiel,
  base,
  peutSaisir,
  peutValider,
}: {
  convention: ConventionDetail;
  lettres: LettreCleActive[];
  actesReferentiel: { id: string; code: string; libelle: string; lettreCleCode?: string | null }[];
  base: string;
  peutSaisir: boolean;
  peutValider: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const modifiable = peutSaisir && c.statut === 'PROPOSEE';
  const rafraichir = (texte?: string) => {
    if (texte) setMessage({ ok: true, texte });
    router.refresh();
  };
  const echec = (texte: string) => setMessage({ ok: false, texte });

  // ---- valeurs : une saisie par (lettre-clé, contexte)
  const [valeurs, setValeurs] = useState<Record<string, string>>(() =>
    Object.fromEntries(c.valeurs.map((v) => [`${v.lettreCleCode}|${v.contexte}`, String(Number(v.valeur))])),
  );
  const codesAffiches = [
    ...lettres.map((l) => l.code),
    ...c.valeurs.map((v) => v.lettreCleCode).filter((code) => !lettres.some((l) => l.code === code)),
  ];
  const libelleLettre = (code: string) => lettres.find((l) => l.code === code)?.libelle ?? code;

  function sauverValeurs() {
    const lignes = Object.entries(valeurs)
      .filter(([, v]) => v.trim() !== '')
      .map(([cle, v]) => {
        const [lettreCleCode, contexte] = cle.split('|');
        return { lettreCleCode, contexte, valeur: Number(v.replace(',', '.')) };
      });
    start(async () => {
      const r = await enregistrerValeurs(c.id, lignes);
      if (r.ok) rafraichir(r.message);
      else echec(r.error);
    });
  }

  // ---- exceptions par acte
  const [lignesActes, setLignesActes] = useState<LigneActe[]>(() =>
    c.actes.map((a) => ({
      referentielActeId: a.referentielActeId,
      code: a.code,
      libelle: a.libelle,
      lettreCleCode: a.lettreCleCode,
      mode: a.prixForfaitaire !== null ? 'FORFAIT' : 'VALEUR',
      montant: String(Number(a.prixForfaitaire ?? a.valeurLettreCle ?? 0)),
    })),
  );
  const [acteChoisi, setActeChoisi] = useState('');
  const disponibles = actesReferentiel.filter((a) => !lignesActes.some((l) => l.referentielActeId === a.id));

  function ajouterActe() {
    const a = actesReferentiel.find((x) => x.id === acteChoisi);
    if (!a) return;
    setLignesActes((prev) => [
      ...prev,
      { referentielActeId: a.id, code: a.code, libelle: a.libelle, lettreCleCode: a.lettreCleCode ?? null, mode: 'FORFAIT', montant: '' },
    ]);
    setActeChoisi('');
  }

  function sauverActes() {
    const actes = lignesActes.map((l) => ({
      referentielActeId: l.referentielActeId,
      ...(l.mode === 'FORFAIT' ? { prixForfaitaire: Number(l.montant.replace(',', '.')) } : { valeurLettreCle: Number(l.montant.replace(',', '.')) }),
    }));
    start(async () => {
      const r = await enregistrerActes(c.id, actes);
      if (r.ok) rafraichir(r.message);
      else echec(r.error);
    });
  }

  async function ouvrirDocument() {
    const r = await urlDocument(c.id);
    if (r.ok) window.open(r.url, '_blank', 'noopener,noreferrer');
    else echec(r.error);
  }

  const blocages = c.blocagesValidation;
  const dernierDeRoute = (statut: string) => LIBELLE_STATUT_CONVENTION[statut] ?? statut;

  return (
    <div className="space-y-6">
      {message && <Alerte ton={message.ok ? 'succes' : 'erreur'}>{message.texte}</Alerte>}

      {/* --- Entête et circuit --- */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">
            Convention {c.numero} <span className="font-normal text-muted-foreground">· version {c.version}</span>
          </CardTitle>
          <StatutBadge statut={c.statut} map={TON_STATUT_CONVENTION} libelles={LIBELLE_STATUT_CONVENTION} />
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <p><span className="text-muted-foreground">Établissement : </span><span className="font-medium">{c.etablissement.nom}</span> ({c.etablissement.code})</p>
            <p><span className="text-muted-foreground">Période : </span><span className="font-medium">{dateFr(c.dateDebut)} → {c.dateFin ? dateFr(c.dateFin) : 'sans date de fin'}</span></p>
            <p><span className="text-muted-foreground">Dépassement : </span>{LIBELLE_POLITIQUE_DEPASSEMENT[c.politiqueDepassement]}</p>
            <p><span className="text-muted-foreground">Saisie : </span>{acteur(c.saisiPar)}, le {dateFr(c.dateSaisie)}</p>
            {c.validePar && <p><span className="text-muted-foreground">Validation : </span>{acteur(c.validePar)}, le {dateFr(c.dateValidation)}</p>}
            {c.historique && <p className="sm:col-span-2 text-xs text-muted-foreground">Convention historique créée par la migration des anciens tarifs conventionnés de l’établissement (sans saisie ni validateur).</p>}
            {c.precedente && (
              <p><span className="text-muted-foreground">Remplace : </span>
                <Link className="underline" href={`${base}/conventions/${c.precedente.id}`}>version {c.precedente.version} ({dernierDeRoute(c.precedente.statut)})</Link>
              </p>
            )}
            {c.suivantes.map((s) => (
              <p key={s.id}><span className="text-muted-foreground">Nouvelle version : </span>
                <Link className="underline" href={`${base}/conventions/${s.id}`}>version {s.version} ({dernierDeRoute(s.statut)})</Link>
              </p>
            ))}
          </div>

          {c.statut === 'REFUSEE' && (
            <Alerte ton="erreur" titre={`Refusée par ${acteur(c.refusePar)} le ${dateFr(c.dateRefus)}`}>
              Motif : {c.motifRefus}
            </Alerte>
          )}
          {c.statut === 'VALIDEE' && (
            <Alerte ton="info">Une convention validée ne se modifie plus : créez une nouvelle version ; l’ancienne est fermée à la validation de la nouvelle.</Alerte>
          )}
          {c.statut === 'PROPOSEE' && peutValider && blocages.length > 0 && (
            <Alerte ton="avertissement" titre="Validation impossible pour le moment">
              {blocages.join(' ')}
            </Alerte>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {modifiable && (
              <FormulaireModal
                titre="Modifier l’entête"
                mode="center"
                declencheur={<Button size="sm" variant="outline">Modifier l’entête</Button>}
                libelleSoumettre="Enregistrer"
                onSoumettre={async (fd) =>
                  modifierConvention(c.id, {
                    numero: String(fd.get('numero') ?? ''),
                    dateDebut: String(fd.get('dateDebut') ?? ''),
                    dateFin: String(fd.get('dateFin') ?? '') || null,
                    politiqueDepassement: String(fd.get('politiqueDepassement') ?? 'PATIENT'),
                  })
                }
                onSucces={() => rafraichir('Entête enregistré.')}
              >
                <ChampTexte name="numero" label="Numéro" required defaultValue={c.numero} />
                <ChampTexte name="dateDebut" label="Date d’effet" type="date" required defaultValue={c.dateDebut.slice(0, 10)} />
                <ChampTexte name="dateFin" label="Date de fin (facultative)" type="date" defaultValue={c.dateFin?.slice(0, 10) ?? ''} />
                <ChampSelect
                  name="politiqueDepassement"
                  label="Dépassement (prix affiché supérieur au tarif reconnu)"
                  defaultValue={c.politiqueDepassement}
                  options={Object.entries(LIBELLE_POLITIQUE_DEPASSEMENT).map(([valeur, libelle]) => ({ valeur, libelle }))}
                />
              </FormulaireModal>
            )}

            {peutValider && c.statut === 'PROPOSEE' && (
              <>
                <ConfirmationAction
                  action="desarchiver"
                  element={`la convention ${c.numero} (version ${c.version})`}
                  consequence="Elle entre en vigueur à sa date d’effet ; les forfaits deviennent applicables aux calculs."
                  libelles={{ titre: 'Valider', bouton: 'Valider la convention', verbe: 'valider' }}
                  verifier={async () => ({ possible: blocages.length === 0, raison: blocages.join(' '), liens: [] })}
                  onConfirmer={() => validerConvention(c.id)}
                  onSucces={() => rafraichir('Convention validée.')}
                />
                <ConfirmationAction
                  action="archiver"
                  element={`la convention ${c.numero} (version ${c.version})`}
                  consequence="L’assurance informatique est informée du motif et peut la corriger puis la reproposer."
                  libelles={{ titre: 'Refuser', bouton: 'Refuser la convention', verbe: 'refuser' }}
                  motif={{ libelle: 'Motif du refus' }}
                  verifier={async () => ({
                    possible: !blocages.some((b) => b.startsWith('Vous avez saisi') || b.startsWith('Votre rôle')),
                    raison: blocages.filter((b) => b.startsWith('Vous avez saisi') || b.startsWith('Votre rôle')).join(' '),
                    liens: [],
                  })}
                  onConfirmer={(motif) => refuserConvention(c.id, motif ?? '')}
                  onSucces={() => rafraichir('Convention refusée.')}
                />
              </>
            )}

            {peutSaisir && c.statut === 'REFUSEE' && (
              <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await reproposerConvention(c.id); if (r.ok) rafraichir(r.message); else echec(r.error); })}>
                Reproposer après correction
              </Button>
            )}

            {peutSaisir && c.statut === 'VALIDEE' && (
              <>
                <FormulaireModal
                  titre="Nouvelle version"
                  mode="center"
                  description="Une copie « proposée » est créée avec les mêmes valeurs ; l’ancienne version est fermée la veille de la date d’effet, à la validation de la nouvelle."
                  declencheur={<Button size="sm">Nouvelle version</Button>}
                  libelleSoumettre="Créer la nouvelle version"
                  onSoumettre={async (fd) => {
                    const r = await nouvelleVersion(c.id, String(fd.get('dateDebut') ?? ''));
                    if (r.ok && r.id) router.push(`${base}/conventions/${r.id}`);
                    return r;
                  }}
                  onSucces={() => router.refresh()}
                >
                  <ChampTexte name="dateDebut" label="Date d’effet de la nouvelle version" type="date" required />
                </FormulaireModal>
                <ConfirmationAction
                  action="archiver"
                  element={`la convention ${c.numero} (version ${c.version})`}
                  consequence="Elle est fermée à la date du jour ; l’historique est conservé. L’établissement n’aura plus de convention en vigueur."
                  verifier={() => verifierAction('convention', c.id, 'archiver')}
                  onConfirmer={() => archiverConvention(c.id)}
                  onSucces={() => rafraichir('Convention archivée.')}
                />
              </>
            )}

            {peutSaisir && (c.statut === 'PROPOSEE' || c.statut === 'REFUSEE') && (
              <ConfirmationAction
                action="supprimer"
                element={`la convention ${c.numero} (version ${c.version})`}
                consequence="Seule une convention jamais validée peut être supprimée."
                verifier={() => verifierAction('convention', c.id, 'supprimer')}
                onConfirmer={async () => {
                  const r = await supprimerConvention(c.id);
                  if (r.ok) router.push(`${base}/conventions`);
                  return r;
                }}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* --- Valeurs par lettre-clé --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Valeurs des lettres-clés (FCFA)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Une valeur par lettre-clé et par contexte. Laissez vide une lettre non négociée : l’acte coté avec cette lettre n’aura pas de tarif reconnu.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-2">Lettre-clé</th>
                {CONTEXTES.map((ctx) => (
                  <th key={ctx} className="py-2 pr-2">{LIBELLE_CONTEXTE_CONVENTION[ctx]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {codesAffiches.map((code) => (
                <tr key={code} className="border-b last:border-0">
                  <td className="py-2 pr-2"><span className="font-mono font-semibold">{code}</span><span className="ml-2 text-xs text-muted-foreground">{libelleLettre(code)}</span></td>
                  {CONTEXTES.map((ctx) => (
                    <td key={ctx} className="py-1 pr-2">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="h-8 w-32"
                        aria-label={`Valeur de ${code} — ${LIBELLE_CONTEXTE_CONVENTION[ctx]}`}
                        value={valeurs[`${code}|${ctx}`] ?? ''}
                        disabled={!modifiable}
                        onChange={(e) => setValeurs((prev) => ({ ...prev, [`${code}|${ctx}`]: e.target.value }))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {modifiable && <Button size="sm" disabled={pending} onClick={sauverValeurs}>Enregistrer les valeurs</Button>}
        </CardContent>
      </Card>

      {/* --- Exceptions par acte --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Exceptions par acte</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Pour un acte donné : un forfait en FCFA, OU une valeur de lettre-clé propre à l’acte (l’acte doit être coté). Jamais les deux.
          </p>
          {lignesActes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune exception : les valeurs des lettres-clés s’appliquent.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-2">Acte</th>
                  <th className="py-2 pr-2">Nature</th>
                  <th className="py-2 pr-2">Montant (FCFA)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lignesActes.map((l, i) => (
                  <tr key={l.referentielActeId} className="border-b last:border-0">
                    <td className="py-2 pr-2">
                      <span className="font-mono text-xs">{l.code}</span> {l.libelle}
                      <span className="block text-xs text-muted-foreground">{l.lettreCleCode ? `Coté ${l.lettreCleCode}` : 'Non coté'}</span>
                    </td>
                    <td className="py-1 pr-2">
                      <select
                        className="h-8 rounded-md border bg-background px-2 text-sm"
                        value={l.mode}
                        disabled={!modifiable}
                        aria-label={`Nature pour ${l.code}`}
                        onChange={(e) => setLignesActes((prev) => prev.map((x, j) => (j === i ? { ...x, mode: e.target.value as 'FORFAIT' | 'VALEUR' } : x)))}
                      >
                        <option value="FORFAIT">Forfait</option>
                        <option value="VALEUR" disabled={!l.lettreCleCode}>Valeur de lettre-clé propre</option>
                      </select>
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="h-8 w-32"
                        aria-label={`Montant pour ${l.code}`}
                        value={l.montant}
                        disabled={!modifiable}
                        onChange={(e) => setLignesActes((prev) => prev.map((x, j) => (j === i ? { ...x, montant: e.target.value } : x)))}
                      />
                    </td>
                    <td className="py-1 text-right">
                      {modifiable && (
                        <Button size="xs" variant="ghost" onClick={() => setLignesActes((prev) => prev.filter((_, j) => j !== i))}>Retirer</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {modifiable && (
            <div className="flex flex-wrap items-end gap-2">
              <select
                className="h-9 min-w-64 rounded-md border bg-background px-2 text-sm"
                value={acteChoisi}
                aria-label="Acte à ajouter"
                onChange={(e) => setActeChoisi(e.target.value)}
              >
                <option value="">Ajouter un acte…</option>
                {disponibles.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.libelle}</option>
                ))}
              </select>
              <Button size="sm" variant="outline" disabled={!acteChoisi} onClick={ajouterActe}>Ajouter</Button>
              <Button size="sm" disabled={pending} onClick={sauverActes}>Enregistrer les exceptions</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* --- Document signé --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Document signé</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {c.document ? (
            <p>
              {c.document.nom ?? 'Document'}{' '}
              <Button size="xs" variant="outline" onClick={ouvrirDocument}>Ouvrir le document</Button>
            </p>
          ) : (
            <p className="text-muted-foreground">Aucun document joint. Le document signé est obligatoire pour valider la convention.</p>
          )}
          {modifiable && (
            <FormulaireModal
              titre={c.document ? 'Remplacer le document signé' : 'Joindre le document signé'}
              mode="center"
              description="PDF, JPEG ou PNG, 10 Mo au plus. Le fichier est stocké dans un espace privé ; seul un lien temporaire permet de l’ouvrir."
              declencheur={<Button size="sm" variant="outline">{c.document ? 'Remplacer le document' : 'Joindre le document'}</Button>}
              libelleSoumettre="Téléverser"
              onSoumettre={async (fd) => joindreDocument(c.id, fd)}
              onSucces={() => rafraichir('Document joint.')}
            >
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Fichier</span>
                <input name="document" type="file" required accept="application/pdf,image/jpeg,image/png" className="block w-full text-sm" />
              </label>
            </FormulaireModal>
          )}
        </CardContent>
      </Card>

      {c.statut === 'VALIDEE' && (
        <p className="text-xs text-muted-foreground">
          Les forfaits de cette convention sont appliqués au calcul à partir de {dateFr(c.dateDebut)} ; les valeurs de lettres-clés et les exceptions de valeur propre seront utilisées par le calcul dès le prochain lot.
        </p>
      )}
    </div>
  );
}
