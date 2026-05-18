'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Cog, FolderKanban, Menu as MenuIcon, Palette, Users } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

const SIDEBAR_ICONS = {
  decks: FolderKanban,
  brandKits: Palette,
  users: Users,
  settings: Cog,
} as const;

type SidebarIconKey = keyof typeof SIDEBAR_ICONS;

type SidebarLink = {
  href: string;
  label: string;
  iconKey: SidebarIconKey;
};
type SidebarSection = { title: string; links: SidebarLink[] };

const SECTIONS: SidebarSection[] = [
  {
    title: 'Workspace',
    links: [
      { href: '/decks', label: 'Decks', iconKey: 'decks' },
      { href: '/brand-kits', label: 'Brand kits', iconKey: 'brandKits' },
    ],
  },
  {
    title: 'Admin',
    links: [
      { href: '/users', label: 'Users', iconKey: 'users' },
      { href: '/settings', label: 'Settings', iconKey: 'settings' },
    ],
  },
];

function SidebarBrand() {
  return (
    <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-4">
      <Image
        src="/logo-mark.png"
        alt="BIP"
        width={28}
        height={28}
        className="bd-ops-logo"
        priority
      />
      <span className="bd-ops-text text-base">BIP Decks</span>
    </div>
  );
}

function SidebarNav({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const pathname = usePathname();
  return (
    <nav className={cn('p-3 text-sm', className)}>
      {SECTIONS.map((section) => (
        <div key={section.title} className="mb-5">
          <h3 className="text-eyebrow px-2 pb-2">{section.title}</h3>
          <ul className="space-y-0.5">
            {section.links.map((link) => {
              const Icon = SIDEBAR_ICONS[link.iconKey];
              const active = pathname === link.href || pathname?.startsWith(link.href + '/');
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors',
                      active
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                        : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                    )}
                  >
                    {active ? (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary"
                      />
                    ) : null}
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{link.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden h-screen w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex lg:w-60">
      <SidebarBrand />
      <ScrollArea className="flex-1">
        <SidebarNav />
      </ScrollArea>
    </aside>
  );
}

export function SidebarMobileTrigger() {
  const [open, setOpen] = React.useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label="Open navigation"
        >
          <MenuIcon className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-64 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground sm:max-w-xs"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SidebarBrand />
        <ScrollArea className="h-[calc(100vh-4rem)]">
          <SidebarNav onNavigate={() => setOpen(false)} />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
