import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Brand } from '@/components/brand';
import { LogoutButton } from '@/components/logout-button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Tableau de bord — Assurance Santé',
};

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

interface IdentityMe {
  profil: {
    id: string;
    organisationId: string | null;
    role: string | null;
    libelleRole: string | null;
    entite: string | null;
    email: string | null;
    numeroOrdreMedecin: string | null;
    methodeConnexion: string | null;
    mfaActive: boolean;
    societeId: string | null;
    etablissementId: string | null;
    pharmacieId: string | null;
    adherentId: string | null;
  };
  permissions: {
    roleChain: string[];
    niveauAcces: string;
    peutValider: boolean;
    dashboardRoute: string | null;
    estRoleMedical: boolean;
    scope: Record<string, string | null>;
  } | null;
}

type FetchResult =
  | { ok: true; data: IdentityMe }
  | { ok: false; status: number; message: string };

async function chargerIdentite(): Promise<{
  email: string;
  result: FetchResult;
}> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?next=/dashboard');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    redirect('/login?next=/dashboard');
  }

  try {
    const res = await fetch(`${API_URL}/api/v1/identity/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
    });

    if (res.ok) {
      return {
        email: user.email ?? '—',
        result: { ok: true, data: (await res.json()) as IdentityMe },
      };
    }

    const body = (await res.json().catch(() => ({}))) as { message?: string };
    return {
      email: user.email ?? '—',
      result: {
        ok: false,
        status: res.status,
        message: body.message ?? res.statusText,
      },
    };
  } catch {
    return {
      email: user.email ?? '—',
      result: {
        ok: false,
        status: 0,
        message: `Impossible de joindre l’API (${API_URL}).`,
      },
    };
  }
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 py-2">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

const Mono = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem]">
    {children}
  </code>
);

export default async function DashboardPage() {
  const { email, result } = await chargerIdentite();

  return (
    <div className="min-h-svh bg-muted/20">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-3">
          <Brand />
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {email}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">Ma session</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vérification de la chaîne complète : Supabase Auth → NestJS
            (<Mono>GET /api/v1/identity/me</Mono>) → Prisma → Postgres. Le vrai
            tableau de bord par rôle viendra plus tard.
          </p>
        </div>

        {!result.ok ? (
          <ErreurCard status={result.status} message={result.message} />
        ) : (
          <IdentiteContenu data={result.data} />
        )}
      </main>
    </div>
  );
}

function ErreurCard({
  status,
  message,
}: {
  status: number;
  message: string;
}) {
  const is404 = status === 404;
  const is401 = status === 401;

  return (
    <Card className="border-amber-300/60 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20">
      <CardHeader>
        <CardTitle className="text-base">
          {is404
            ? 'Compte authentifié, mais profil non provisionné'
            : is401
              ? 'Session non valide'
              : 'L’API a renvoyé une erreur'}
        </CardTitle>
        <CardDescription>
          HTTP {status || '—'} — {message}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {is404 && (
          <p>
            L’utilisateur existe dans Supabase Auth mais aucune ligne{' '}
            <Mono>profils</Mono> ne lui est associée. Un administrateur doit
            créer le compte applicatif (module <Mono>identity</Mono>).
          </p>
        )}
        {is401 && (
          <p>
            Le jeton n’a pas été accepté par le guard NestJS.{' '}
            <Link href="/login" className="underline underline-offset-4">
              Se reconnecter
            </Link>
            .
          </p>
        )}
        {!is404 && !is401 && (
          <p>Réessayez plus tard ou vérifiez que l’API NestJS est démarrée.</p>
        )}
      </CardContent>
    </Card>
  );
}

function IdentiteContenu({ data }: { data: IdentityMe }) {
  const { profil, permissions } = data;

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Card className="sm:col-span-2">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {profil.role ? (
              <Mono>{profil.role}</Mono>
            ) : (
              <span className="text-muted-foreground">Aucun rôle assigné</span>
            )}
            {profil.entite && (
              <Badge variant="secondary">{profil.entite}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {profil.libelleRole ?? 'Le compte n’a pas encore de sous-rôle.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 sm:grid-cols-2">
            <Field label="Email">{profil.email ?? '—'}</Field>
            <Field label="Méthode de connexion">
              {profil.methodeConnexion ?? '—'}
            </Field>
            <Field label="MFA active">
              <Badge variant={profil.mfaActive ? 'success' : 'muted'}>
                {profil.mfaActive ? 'oui' : 'non'}
              </Badge>
            </Field>
            <Field label="N° ordre médecin">
              {profil.numeroOrdreMedecin ?? '—'}
            </Field>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Permissions effectives</CardTitle>
          <CardDescription>
            Résolues via la chaîne d’héritage des sous-rôles.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {permissions ? (
            <dl>
              <Field label="Niveau d’accès">
                <Badge>{permissions.niveauAcces}</Badge>
              </Field>
              <Field label="Peut valider">
                <Badge variant={permissions.peutValider ? 'success' : 'muted'}>
                  {permissions.peutValider ? 'oui' : 'non'}
                </Badge>
              </Field>
              <Field label="Rôle médical">
                <Badge variant={permissions.estRoleMedical ? 'success' : 'muted'}>
                  {permissions.estRoleMedical ? 'oui' : 'non'}
                </Badge>
              </Field>
              <Field label="Chaîne de rôles">
                <div className="flex flex-wrap gap-1.5">
                  {permissions.roleChain.map((r) => (
                    <Badge key={r} variant="outline">
                      {r}
                    </Badge>
                  ))}
                </div>
              </Field>
              <Field label="Dashboard cible">
                {permissions.dashboardRoute ? (
                  <span className="flex flex-col gap-1">
                    <Mono>{permissions.dashboardRoute}</Mono>
                    <span className="text-xs text-muted-foreground">
                      redirection par rôle à implémenter
                    </span>
                  </span>
                ) : (
                  '—'
                )}
              </Field>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aucune permission : le compte n’a pas de sous-rôle assigné.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Périmètre (multi-tenant)</CardTitle>
          <CardDescription>Scopes rattachés au profil.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl>
            <Field label="Organisation">
              {profil.organisationId ? (
                <Mono>{profil.organisationId}</Mono>
              ) : (
                '—'
              )}
            </Field>
            <Field label="Société">
              {profil.societeId ? <Mono>{profil.societeId}</Mono> : '—'}
            </Field>
            <Field label="Établissement">
              {profil.etablissementId ? (
                <Mono>{profil.etablissementId}</Mono>
              ) : (
                '—'
              )}
            </Field>
            <Field label="Pharmacie">
              {profil.pharmacieId ? <Mono>{profil.pharmacieId}</Mono> : '—'}
            </Field>
          </dl>
        </CardContent>
      </Card>

      <details className="group sm:col-span-2">
        <summary className="cursor-pointer list-none text-sm text-muted-foreground hover:text-foreground">
          <span className="underline underline-offset-4">
            Réponse brute de l’API
          </span>
        </summary>
        <pre className="mt-3 overflow-x-auto rounded-lg border bg-background p-4 text-xs">
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}
