'use client';

import { useState, useTransition } from 'react';

import {
  inviterUtilisateur,
  revoquerInvitation,
  validerProposition,
  type ResultatInvitation,
} from '@/app/dashboard-assureur/informatique/utilisateurs/actions';
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

export function UtilisateursPanneau({
  comptes,
  invitations,
  roles,
  erreur,
}: {
  comptes: Compte[];
  invitations: Invitation[];
  roles: RoleProposable[];
  erreur: string | null;
}) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ResultatInvitation | null>(null);

  const invitationsOuvertes = invitations.filter((i) =>
    ['EN_ATTENTE_VALIDATION_INFORMATIQUE', 'EN_ATTENTE'].includes(i.statut),
  );

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
            className="grid gap-3 sm:grid-cols-[1fr_16rem_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const form = e.currentTarget;
              start(async () => {
                const r = await inviterUtilisateur({
                  email: String(f.get('email') ?? ''),
                  rolePropose: String(f.get('role') ?? ''),
                });
                setRes(r);
                if (r.ok) form.reset();
              });
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="collaborateur@assureur.ci"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role">Rôle</Label>
              <select
                id="role"
                name="role"
                required
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                defaultValue=""
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
            <Button type="submit" disabled={pending}>
              {pending ? 'Envoi…' : 'Inviter'}
            </Button>
            <div className="sm:col-span-3">
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
                      <Badge
                        variant={
                          inv.statut === 'EN_ATTENTE_VALIDATION_INFORMATIQUE'
                            ? 'outline'
                            : 'secondary'
                        }
                      >
                        {LIBELLE_STATUT[inv.statut] ?? inv.statut}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(inv.expireLe).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="flex justify-end gap-2">
                        {inv.statut ===
                          'EN_ATTENTE_VALIDATION_INFORMATIQUE' && (
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
