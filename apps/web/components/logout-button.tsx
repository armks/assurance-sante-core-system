'use client';

import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

export function LogoutButton() {
  const router = useRouter();

  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <Button onClick={logout} variant="outline" size="sm">
      Se déconnecter
    </Button>
  );
}
