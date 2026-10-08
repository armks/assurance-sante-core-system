'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { verifierAction, type VerdictsListe } from '@/app/dependances-actions';
import {
  changerRoleCompte,
  reactiverCompte,
  renvoyerNouvelleInvitation,
  revoquerCompte,
  supprimerCompte,
  inviterUtilisateur,
  rejeterInvitation,
  renvoyerEmail,
  revoquerInvitation,
  validerProposition,
  type ResultatInvitation,
} from '@/app/dashboard-assureur/informatique/utilisateurs/actions';
import { ChampSelect, ChampZone, ConfirmationAction, FormulaireModal } from '@/components/dashboard/patterns';
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
  /** Compte désactivé par un archivage (rétabli à la main) ; null/absent = actif. */
  desactiveLe?: string | null;
  desactiveMotif?: string | null;
  /** ACTIF | REVOQUE (révocation manuelle ; le compte n'est jamais supprimé). */
  statut?: string;
  revoqueMotif?: string | null;
  /** Entité du rôle : un changement de rôle reste dans l'entité. */
  entiteRole?: string | null;
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
  /** Invitation qui l'a remplacée (révoquée / expirée → renvoyée). */
  remplaceePar?: string | null;
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
  verdicts = {},
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
  /** Verdicts « action possible ? » des comptes ET des invitations (par id). */
  verdicts?: VerdictsListe;
}) {
  const router = useRouter();
  const [voirRevoques, setVoirRevoques] = useState(false);
  const nbRevoques = comptes.filter((c) => c.statut === 'REVOQUE').length;
  const comptesVisibles = voirRevoques ? comptes : comptes.filter((c) => c.statut !== 'REVOQUE');
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
                          {inv.statut === 'EN_ATTENTE' && inv.emailEnvoye === false
                            ? 'En attente d’acceptation'
                            : (LIBELLE_STATUT[inv.statut] ?? inv.statut)}
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
                  <th className="px-3 py-2" />
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
                    <td className="px-3 py-2 text-right">
                      {(inv.statut === 'REVOQUEE' || inv.statut === 'EXPIREE') &&
                        (inv.remplaceePar ? (
                          <span className="text-xs text-muted-foreground">Remplacée</span>
                        ) : (
                          <ConfirmationAction
                            action="desarchiver"
                            libelles={{ titre: 'Renvoyer', bouton: 'Renvoyer', verbe: 'renvoyer' }}
                            element={`l’invitation de ${inv.email}`}
                            consequence="Une NOUVELLE invitation (nouveau lien, nouvelle échéance) est envoyée à la même adresse, pour le même rôle. L’ancienne reste dans l’historique."
                            verifier={() => verifierAction('invitation', inv.id, 'desarchiver')}
                            onConfirmer={() => renvoyerNouvelleInvitation(inv.id)}
                            onSucces={() => router.refresh()}
                            declencheur={
                              <Button type="button" size="xs" variant="outline">
                                Renvoyer l’invitation
                              </Button>
                            }
                          />
                        ))}
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
          Comptes de l’organisation ({comptesVisibles.length})
        </h2>
        {nbRevoques > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={voirRevoques} onChange={(e) => setVoirRevoques(e.target.checked)} />
            Révoqués ({nbRevoques})
          </label>
        )}
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
                  <th className="px-3 py-2 font-medium">État</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {comptesVisibles.map((c) => {
                  const revoque = c.statut === 'REVOQUE';
                  const v = verdicts[c.id];
                  const nomCompte = `le compte ${c.email ?? c.id}`;
                  const rolesPossibles = roles.filter((r) => r.code !== c.role && (!c.entiteRole || r.entite === c.entiteRole));
                  return (
                    <tr key={c.id} className="border-t">
                      <td className="px-3 py-2">{c.email ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.libelleRole ?? c.role ?? 'Sans rôle'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{new Date(c.createdAt).toLocaleDateString('fr-FR')}</td>
                      <td className="px-3 py-2">
                        {revoque ? (
                          <span title={c.revoqueMotif ?? undefined}>
                            <Badge variant="outline">Révoqué</Badge>
                          </span>
                        ) : c.desactiveLe ? (
                          <span title={c.desactiveMotif ?? undefined}>
                            <Badge variant="outline">Désactivé</Badge>
                          </span>
                        ) : (
                          <Badge variant="success">Actif</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="flex flex-wrap justify-end gap-2">
                          {!revoque && (
                            <FormulaireModal
                              titre="Changer le rôle"
                              description={`Rôle actuel : ${c.libelleRole ?? c.role ?? '—'}. Seuls les rôles permis par les règles de provisioning, de la même entité, sont proposés. Ancien et nouveau rôle sont tracés ; le changement est effectif dès la prochaine requête du compte.`}
                              declencheur={
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="ghost"
                                  disabled={(!!v?.modifier && !v.modifier.possible) || rolesPossibles.length === 0}
                                  title={v?.modifier && !v.modifier.possible ? (v.modifier.raison ?? undefined) : undefined}
                                >
                                  Changer le rôle
                                </Button>
                              }
                              libelleSoumettre="Changer le rôle"
                              onSoumettre={async (fd) => changerRoleCompte(c.id, String(fd.get('role') ?? ''))}
                              onSucces={() => router.refresh()}
                            >
                              <ChampSelect
                                name="role"
                                label="Nouveau rôle"
                                required
                                placeholder="Choisir un rôle…"
                                options={rolesPossibles.map((r) => ({ valeur: r.code, libelle: r.libelle }))}
                              />
                            </FormulaireModal>
                          )}
                          {revoque || c.desactiveLe ? (
                            <ConfirmationAction
                              action="desarchiver"
                              libelles={{ titre: 'Réactiver', bouton: 'Réactiver', verbe: 'réactiver' }}
                              element={nomCompte}
                              consequence={
                                revoque
                                  ? `Révoqué (${c.revoqueMotif ?? 'sans motif'}). Le blocage est levé : il pourra de nouveau se connecter.`
                                  : `Désactivé : ${c.desactiveMotif ?? 'archivage'}. Il pourra de nouveau se connecter, si sa structure n’est plus archivée.`
                              }
                              verifier={() => verifierAction('utilisateur', c.id, 'desarchiver')}
                              onConfirmer={() => reactiverCompte(c.id)}
                              onSucces={() => router.refresh()}
                              declencheur={
                                <Button type="button" size="xs" variant="ghost">
                                  Réactiver
                                </Button>
                              }
                            />
                          ) : (
                            <ConfirmationAction
                              action="archiver"
                              libelles={{ titre: 'Révoquer', bouton: 'Révoquer', verbe: 'révoquer' }}
                              element={nomCompte}
                              consequence="Son accès est coupé immédiatement : ses jetons et sessions ouverts sont refusés. Le compte et son historique sont conservés ; vous pourrez le réactiver."
                              verifier={() => verifierAction('utilisateur', c.id, 'archiver')}
                              onConfirmer={() => revoquerCompte(c.id)}
                              onSucces={() => router.refresh()}
                              declencheur={
                                <Button type="button" size="xs" variant="ghost">
                                  Révoquer
                                </Button>
                              }
                            />
                          )}
                          <ConfirmationAction
                            action="supprimer"
                            element={nomCompte}
                            consequence="Possible uniquement s’il n’a aucune référence ni ligne d’historique (audit). Préférez la révocation."
                            verifier={() => verifierAction('utilisateur', c.id, 'supprimer')}
                            onConfirmer={() => supprimerCompte(c.id)}
                            onSucces={() => router.refresh()}
                          />
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {comptesVisibles.length === 0 && (
                  <tr className="border-t">
                    <td
                      className="px-3 py-6 text-center text-muted-foreground"
                      colSpan={5}
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
