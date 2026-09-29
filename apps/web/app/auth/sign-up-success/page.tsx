import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
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
