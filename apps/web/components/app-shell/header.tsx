import { LogOut } from 'lucide-react';
import { redirect } from 'next/navigation';

import { getSessionContext } from '@/lib/auth/middleware';
import { clearSessionCookie, readSessionCookie } from '@/lib/auth/cookies';
import { logout as logoutService } from '@/lib/auth/service';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ParticlesToggle } from '@/components/particles-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { SidebarMobileTrigger } from '@/components/app-shell/sidebar';

async function signOut() {
  'use server';
  const raw = await readSessionCookie();
  await logoutService(raw);
  await clearSessionCookie();
  redirect('/login');
}

function initials(name: string | null | undefined, email: string | null | undefined) {
  const source = (name && name.trim()) || email || '';
  if (!source) return '?';
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return source.slice(0, 2).toUpperCase();
  const first = parts[0] ?? '';
  const second = parts[1] ?? '';
  return ((first[0] ?? '') + (second[0] ?? '')).toUpperCase() || '?';
}

export async function Header() {
  const ctx = await getSessionContext();
  const user = ctx?.user;

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
      <SidebarMobileTrigger />
      <div className="flex-1" />
      <div className="flex items-center gap-1">
        <ParticlesToggle />
        <ThemeToggle />
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="rounded-full"
                aria-label="Account menu"
              >
                <Avatar size="sm">
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {initials(user.name, user.email)}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            {/* portal'd dropdown sized to content */}
            <DropdownMenuContent align="end" className="min-w-[14rem]"> {/* responsive-allow */}
              <DropdownMenuLabel className="flex items-start gap-3 py-2">
                <Avatar size="default">
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {initials(user.name, user.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="truncate text-sm font-medium">{user.name ?? user.email}</div>
                  {user.name ? (
                    <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                  ) : null}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <form action={signOut}>
                <button
                  type="submit"
                  className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </header>
  );
}
