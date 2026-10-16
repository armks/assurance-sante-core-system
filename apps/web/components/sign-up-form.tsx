'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { cn } from '@/lib/utils'
import { messageErreurAuth } from '@/lib/auth-erreurs'
import { sInscrire } from '@/app/auth-actions'
import { CaptchaChamp, type ValeurCaptcha } from '@/components/captcha-champ'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Link from 'next/link'

export function SignUpForm({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [captcha, setCaptcha] = useState<ValeurCaptcha>({ jeton: '', reponse: '' })
  const [renouvelerCaptcha, setRenouvelerCaptcha] = useState(0)
  const router = useRouter()

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    if (password !== repeatPassword) {
      setError('Les deux mots de passe ne correspondent pas.')
      setIsLoading(false)
      return
    }

    try {
      const res = await sInscrire({ email, password, captchaJeton: captcha.jeton, captchaReponse: captcha.reponse })
      if (!res.ok) {
        setError(res.error)
        setRenouvelerCaptcha((n) => n + 1)
        return
      }
      router.push('/auth/sign-up-success')
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
          <CardTitle className="text-2xl">Créer un compte</CardTitle>
          <CardDescription>Renseignez votre e-mail et choisissez un mot de passe.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignUp}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
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
                </div>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="repeat-password">Confirmer le mot de passe</Label>
                </div>
                <Input
                  id="repeat-password"
                  name="repeat-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={repeatPassword}
                  onChange={(e) => setRepeatPassword(e.target.value)}
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <CaptchaChamp onChange={setCaptcha} renouveler={renouvelerCaptcha} />
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Création du compte…' : 'Créer le compte'}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm">
              Déjà un compte ?{' '}
              <Link href="/login" className="underline underline-offset-4">
                Se connecter
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
