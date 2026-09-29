import Link from 'next/link'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default async function Page({ searchParams }: { searchParams: Promise<{ error: string }> }) {
  const params = await searchParams

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Une erreur est survenue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Ce lien est invalide ou a expiré. Recommencez la procédure ou contactez votre
                administrateur.
              </p>
              {params?.error && (
                // message brut de Supabase (anglais), conservé pour le support
                <p className="text-xs text-muted-foreground">Détail technique : {params.error}</p>
              )}
              <Link href="/login" className="inline-block text-sm underline underline-offset-4">
                Retour à la connexion
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
