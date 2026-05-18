"use client";

import { usePathname } from "next/navigation";

import { ParticleBackground } from "@/components/particle-background";

/** Routes where the ambient particle background is suppressed (busy UI). */
const NO_PARTICLE_PREFIXES = ["/decks/", "/users", "/settings"];

function shouldShowParticles(pathname: string | null): boolean {
  if (!pathname) return true;
  return !NO_PARTICLE_PREFIXES.some((p) =>
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(p + "/"),
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

  return (
    <main className="relative flex-1 overflow-y-auto">
      {show ? <ParticleBackground intensity="ambient" /> : null}
      <div className="relative z-10 mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </div>
    </main>
  );
}
