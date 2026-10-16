'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { cn } from '@/lib/utils'
import { messageErreurAuth } from '@/lib/auth-erreurs'
import { safeNextPath } from '@/lib/safe-next-path'
import { seConnecter } from '@/app/auth-actions'
import { CaptchaChamp, type ValeurCaptcha } from '@/components/captcha-champ'
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
  const [isLoading, setIsLoading] = useState(false)
  const [captcha, setCaptcha] = useState<ValeurCaptcha>({ jeton: '', reponse: '' })
  const [renouvelerCaptcha, setRenouvelerCaptcha] = useState(0)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      // Connexion côté serveur : le CAPTCHA est vérifié AVANT toute tentative sur le mot de passe.
      const res = await seConnecter({ email, password, captchaJeton: captcha.jeton, captchaReponse: captcha.reponse })
      if (!res.ok) {
        setError(res.error)
        setRenouvelerCaptcha((n) => n + 1) // un jeton ne sert qu'une fois : nouvelle image
        return
      }
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
                  // Pas de curseur d'office dans ce champ (aucun autoFocus : l'historique ne s'affiche pas à l'ouverture de la page), mais l'historique des
                  // e-mails enregistrés est proposé dès qu'on CLIQUE dedans : champ éditable, `autoComplete="username"`.
                  autoComplete="username"
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
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <CaptchaChamp onChange={setCaptcha} renouveler={renouvelerCaptcha} />
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
