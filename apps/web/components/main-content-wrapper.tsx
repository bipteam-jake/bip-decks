'use client';

import { usePathname } from 'next/navigation';

import { ParticleBackground } from '@/components/particle-background';

/** Routes where the ambient particle background is suppressed (busy UI). */
const NO_PARTICLE_PREFIXES = ['/decks/', '/users', '/settings'];

/** Routes that want full-bleed width (no max-w container) — typically
 *  editor surfaces where every horizontal pixel is useful. */
const FULL_BLEED_PREFIXES = ['/decks/'];

function shouldShowParticles(pathname: string | null): boolean {
  if (!pathname) return true;
  return !NO_PARTICLE_PREFIXES.some((p) =>
    p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(p + '/'),
  );
}

function isFullBleed(pathname: string | null): boolean {
  if (!pathname) return false;
  return FULL_BLEED_PREFIXES.some((p) =>
    p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(p + '/'),
  );
}

export function MainContentWrapper({
  children,
  particles,
}: {
  children: React.ReactNode;
  /** Force particles on/off. When omitted, decided from the current pathname. */
  particles?: boolean;
}) {
  const pathname = usePathname();
  const show = particles ?? shouldShowParticles(pathname);
  const fullBleed = isFullBleed(pathname);

  return (
    <main className="relative flex-1 overflow-y-auto">
      {show ? <ParticleBackground intensity="ambient" /> : null}
      <div
        className={
          fullBleed
            ? 'relative z-10 w-full px-3 py-3 sm:px-4 lg:px-5'
            : 'relative z-10 mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8'
        }
      >
        {children}
      </div>
    </main>
  );
}
