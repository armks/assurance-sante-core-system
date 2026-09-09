import { redirect } from 'next/navigation';

export default function Home() {
  // Le middleware redirige vers /login si pas de session.
  redirect('/dashboard');
}
