'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { cn } from '@/lib/utils'
import { messageErreurAuth } from '@/lib/auth-erreurs'
import { safeNextPath } from '@/lib/safe-next-path'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { annoncerOuvertureLente } from '@/components/effet-defilement'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Link from 'next/link'

export function LoginForm({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Champs éditables seulement après un premier clic / Tab : aucune proposition d'historique ni remplissage automatique à l'affichage
  const [champsPrets, setChampsPrets] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()
    setIsLoading(true)
    setError(null)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) throw error
      const next = new URLSearchParams(window.location.search).get('next')
      annoncerOuvertureLente() // la première page affichée après la connexion s'ouvre lentement (du haut vers le bas)
      router.push(safeNextPath(next, '/dashboard'))
    } catch (error: unknown) {
      setError(messageErreurAuth(error))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Connexion</CardTitle>
          <CardDescription>Saisissez votre e-mail et votre mot de passe.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  // Aucun curseur d'office dans ce champ et aucune proposition d'historique : pas de remplissage automatique d'e-mail / mot de passe.
                  // Champ en lecture seule jusqu'au premier clic (les navigateurs ne proposent rien sur un champ non éditable), `autoComplete` désactivé.
                  autoComplete="off"
                  readOnly={!champsPrets}
                  onFocus={() => setChampsPrets(true)}
                  spellCheck={false}
                  placeholder="nom@exemple.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Mot de passe</Label>
                  <Link
                    href="/auth/forgot-password"
                    className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                  >
                    Mot de passe oublié ?
                  </Link>
                </div>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  readOnly={!champsPrets}
                  onFocus={() => setChampsPrets(true)}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Connexion…' : 'Se connecter'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
