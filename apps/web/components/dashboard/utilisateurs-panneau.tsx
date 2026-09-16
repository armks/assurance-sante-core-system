'use client';

import { useState, useTransition } from 'react';

import {
  inviterUtilisateur,
  rejeterInvitation,
  renvoyerEmail,
  revoquerInvitation,
  validerProposition,
  type ResultatInvitation,
} from '@/app/dashboard-assureur/informatique/utilisateurs/actions';
import { ChampZone, FormulaireModal } from '@/components/dashboard/patterns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface RoleProposable {
  code: string;
  libelle: string;
  entite: string;
  mode: 'CREATION_DIRECTE' | 'PROPOSITION';
}

export interface Ressource {
  id: string;
  nom: string;
}

type TypeChampScope = 'etablissement' | 'pharmacie' | 'souscripteur';

/** Rôle → champ de rattachement obligatoire à l'invitation (formulaire ET API). */
function typeChampScope(role: string): TypeChampScope | null {
  if (role.startsWith('CENTRE_MEDICAL_')) return 'etablissement';
  if (role.startsWith('PHARMACIE_')) return 'pharmacie';
  if (role === 'SOCIETE_ADMINISTRATION') return 'souscripteur';
  return null;
}

const LIBELLE_CHAMP_SCOPE: Record<TypeChampScope, string> = {
  etablissement: 'Établissement',
  pharmacie: 'Pharmacie',
  souscripteur: 'Souscripteur',
};

export interface Compte {
  id: string;
  role: string | null;
  libelleRole: string | null;
  email: string | null;
  createdAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  rolePropose: string;
  statut: string;
  mode: string;
  roleValidateur: string | null;
  expireLe: string;
  createdAt: string;
  emailEnvoye?: boolean | null;
  lienAcceptation?: string;
}

const LIBELLE_STATUT: Record<string, string> = {
  EN_ATTENTE_VALIDATION_INFORMATIQUE: 'À valider',
  EN_ATTENTE: 'Invitation envoyée',
  ACCEPTEE: 'Acceptée',
  REJETEE: 'Rejetée',
  EXPIREE: 'Expirée',
  REVOQUEE: 'Révoquée',
};

function Message({ res }: { res: ResultatInvitation | null }) {
  if (!res) return null;
  return (
    <p
      className={
        res.ok
          ? 'text-sm text-emerald-700 dark:text-emerald-400'
          : 'text-sm text-destructive'
      }
    >
      {res.ok ? res.message : res.error}
    </p>
  );
}

const STATUTS_CLOS = ['ACCEPTEE', 'REJETEE', 'REVOQUEE', 'EXPIREE'];

export function UtilisateursPanneau({
  comptes,
  invitations,
  roles,
  erreur,
  peutValider = true,
  etablissements = [],
  pharmacies = [],
  souscripteurs = [],
}: {
  comptes: Compte[];
  invitations: Invitation[];
  roles: RoleProposable[];
  erreur: string | null;
  /** `false` pour un rôle adjoint : masque « Valider » / « Rejeter ». */
  peutValider?: boolean;
  etablissements?: Ressource[];
  pharmacies?: Ressource[];
  souscripteurs?: Ressource[];
}) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ResultatInvitation | null>(null);
  const [role, setRole] = useState('');
  const [champScope, setChampScope] = useState('');

  const typeChampRequis = typeChampScope(role);
  const ressourcesParType: Record<TypeChampScope, Ressource[]> = {
    etablissement: etablissements,
    pharmacie: pharmacies,
    souscripteur: souscripteurs,
  };
  const optionsChampScope = typeChampRequis
    ? ressourcesParType[typeChampRequis]
    : [];
  const boutonInviterDesactive =
    pending || (typeChampRequis !== null && !champScope);

  const invitationsOuvertes = invitations.filter((i) =>
    ['EN_ATTENTE_VALIDATION_INFORMATIQUE', 'EN_ATTENTE'].includes(i.statut),
  );
  const invitationsCloses = invitations.filter((i) =>
    STATUTS_CLOS.includes(i.statut),
  );

  const copierLien = (lien: string) => {
    const url = `${window.location.origin}${lien}`;
    navigator.clipboard.writeText(url).then(
      () => setRes({ ok: true, message: 'Lien copié dans le presse-papiers.' }),
      () =>
        setRes({
          ok: false,
          error: `Copie automatique impossible. Lien : ${url}`,
        }),
    );
  };

  return (
    <div className="space-y-10">
      {/* --- Formulaire de création --- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Inviter un compte
        </h2>
        {roles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Votre rôle ne permet de créer aucun compte.
          </p>
        ) : (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const form = e.currentTarget;
              start(async () => {
                const r = await inviterUtilisateur({
                  email: String(f.get('email') ?? ''),
                  rolePropose: role,
                  ...(typeChampRequis === 'etablissement'
                    ? { etablissementId: champScope }
                    : {}),
                  ...(typeChampRequis === 'pharmacie'
                    ? { pharmacieId: champScope }
                    : {}),
                  ...(typeChampRequis === 'souscripteur'
                    ? { societeId: champScope }
                    : {}),
                });
                setRes(r);
                if (r.ok) {
                  form.reset();
                  setRole('');
                  setChampScope('');
                }
              });
            }}
          >
            <div className="grid min-w-[14rem] flex-1 gap-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="collaborateur@assureur.ci"
              />
            </div>
            <div className="grid w-64 gap-2">
              <Label htmlFor="role">Rôle</Label>
              <select
                id="role"
                name="role"
                required
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  setChampScope('');
                }}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="" disabled>
                  Choisir un rôle…
                </option>
                {roles.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.libelle}
                    {r.mode === 'PROPOSITION' ? ' (soumis à validation)' : ''}
                  </option>
                ))}
              </select>
            </div>
            {typeChampRequis && (
              <div className="grid w-64 gap-2">
                <Label htmlFor="champScope">
                  {LIBELLE_CHAMP_SCOPE[typeChampRequis]}
                </Label>
                <select
                  id="champScope"
                  name="champScope"
                  required
                  value={champScope}
                  onChange={(e) => setChampScope(e.target.value)}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="" disabled>
                    Choisir…
                  </option>
                  {optionsChampScope.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nom}
                    </option>
                  ))}
                </select>
                {optionsChampScope.length === 0 && (
                  <p className="text-xs text-destructive">
                    Aucun{typeChampRequis === 'etablissement' ? '' : 'e'}{' '}
                    {LIBELLE_CHAMP_SCOPE[typeChampRequis].toLowerCase()}{' '}
                    disponible.
                  </p>
                )}
              </div>
            )}
            <Button type="submit" disabled={boutonInviterDesactive}>
              {pending ? 'Envoi…' : 'Inviter'}
            </Button>
            <div className="basis-full">
              <Message res={res} />
            </div>
          </form>
        )}
      </section>

      {/* --- Invitations en cours --- */}
      {invitationsOuvertes.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Invitations en cours ({invitationsOuvertes.length})
          </h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">E-mail</th>
                  <th className="px-3 py-2 font-medium">Rôle</th>
                  <th className="px-3 py-2 font-medium">Statut</th>
                  <th className="px-3 py-2 font-medium">Expire le</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {invitationsOuvertes.map((inv) => (
                  <tr key={inv.id} className="border-t">
                    <td className="px-3 py-2">{inv.email}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {inv.rolePropose}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant={
                            inv.statut === 'EN_ATTENTE_VALIDATION_INFORMATIQUE'
                              ? 'outline'
                              : 'secondary'
                          }
                        >
                          {LIBELLE_STATUT[inv.statut] ?? inv.statut}
                        </Badge>
                        {inv.statut === 'EN_ATTENTE' &&
                          inv.emailEnvoye === false && (
                            <Badge variant="danger">Email non envoyé</Badge>
                          )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(inv.expireLe).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="flex flex-wrap justify-end gap-2">
                        {inv.statut === 'EN_ATTENTE_VALIDATION_INFORMATIQUE' &&
                          peutValider && (
                            <>
                              <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                disabled={pending}
                                onClick={() =>
                                  start(async () =>
                                    setRes(await validerProposition(inv.id)),
                                  )
                                }
                              >
                                Valider
                              </Button>
                              <FormulaireModal
                                titre="Rejeter la proposition"
                                mode="center"
                                description={`Proposition de compte ${inv.rolePropose} pour ${inv.email}. Le motif est tracé dans l'audit.`}
                                declencheur={
                                  <Button
                                    type="button"
                                    size="xs"
                                    variant="ghost"
                                    disabled={pending}
                                  >
                                    Rejeter
                                  </Button>
                                }
                                libelleSoumettre="Rejeter"
                                onSoumettre={async (fd) => {
                                  const r = await rejeterInvitation(
                                    inv.id,
                                    String(fd.get('motif') ?? ''),
                                  );
                                  return r.ok
                                    ? { ok: true, message: r.message }
                                    : { ok: false, error: r.error };
                                }}
                                onSucces={(m) =>
                                  setRes({
                                    ok: true,
                                    message: m ?? 'Proposition rejetée.',
                                  })
                                }
                              >
                                <ChampZone
                                  name="motif"
                                  label="Motif du rejet"
                                  rows={3}
                                  aide="Facultatif — communiqué en interne, tracé dans l'audit."
                                />
                              </FormulaireModal>
                            </>
                          )}
                        {inv.statut === 'EN_ATTENTE' &&
                          inv.emailEnvoye === false && (
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                start(async () =>
                                  setRes(await renvoyerEmail(inv.id)),
                                )
                              }
                            >
                              Renvoyer l’email
                            </Button>
                          )}
                        {inv.statut === 'EN_ATTENTE' && inv.lienAcceptation && (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => copierLien(inv.lienAcceptation!)}
                          >
                            Copier le lien
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            start(async () =>
                              setRes(await revoquerInvitation(inv.id)),
                            )
                          }
                        >
                          Révoquer
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* --- Invitations traitées (historique) --- */}
      {invitationsCloses.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Invitations traitées ({invitationsCloses.length})
          </h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">E-mail</th>
                  <th className="px-3 py-2 font-medium">Rôle</th>
                  <th className="px-3 py-2 font-medium">Statut</th>
                  <th className="px-3 py-2 font-medium">Créée le</th>
                </tr>
              </thead>
              <tbody>
                {invitationsCloses.map((inv) => (
                  <tr key={inv.id} className="border-t">
                    <td className="px-3 py-2">{inv.email}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {inv.rolePropose}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          inv.statut === 'ACCEPTEE' ? 'secondary' : 'outline'
                        }
                      >
                        {LIBELLE_STATUT[inv.statut] ?? inv.statut}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(inv.createdAt).toLocaleDateString('fr-FR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* --- Comptes de l'organisation --- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Comptes de l’organisation ({comptes.length})
        </h2>
        {erreur ? (
          <p className="text-sm text-destructive">{erreur}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">E-mail</th>
                  <th className="px-3 py-2 font-medium">Rôle</th>
                  <th className="px-3 py-2 font-medium">Créé le</th>
                </tr>
              </thead>
              <tbody>
                {comptes.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="px-3 py-2">{c.email ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {c.libelleRole ?? c.role ?? 'Sans rôle'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString('fr-FR')}
                    </td>
                  </tr>
                ))}
                {comptes.length === 0 && (
                  <tr className="border-t">
                    <td
                      className="px-3 py-6 text-center text-muted-foreground"
                      colSpan={3}
                    >
                      Aucun compte.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
