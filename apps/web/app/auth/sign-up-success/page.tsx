import { LienAccueil } from '@/components/lien-accueil'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default function Page() {
  return (
    <div className="relative flex min-h-svh w-full items-center justify-center p-6 pt-16 md:p-10">
      <LienAccueil />
      {/* Même effet d'ouverture que le méga menu et la page de connexion. */}
      <div className="megamenu-panneau w-full max-w-sm" style={{ animationDelay: '350ms' }}>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Compte créé</CardTitle>
              <CardDescription>Confirmez votre adresse e-mail</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Votre compte a bien été créé. Consultez votre messagerie pour confirmer votre
                adresse avant de vous connecter.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
