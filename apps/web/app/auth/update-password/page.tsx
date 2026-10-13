import { UpdatePasswordForm } from '@/components/update-password-form'

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      {/* Même effet d'ouverture que le méga menu et la page de connexion : la carte se déroule du haut, lentement. */}
      <div className="megamenu-panneau w-full max-w-sm" style={{ animationDelay: '350ms' }}>
        <UpdatePasswordForm />
      </div>
    </div>
  )
}
