"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const STORAGE_KEY = "particles-enabled";

function readEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(STORAGE_KEY) !== "false";
}

export function ParticlesToggle() {
  const [enabled, setEnabled] = React.useState(true);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    setEnabled(readEnabled());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setEnabled(readEnabled());
    };
    const onCustom = () => setEnabled(readEnabled());
    window.addEventListener("storage", onStorage);
    window.addEventListener("particles-preference-changed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("particles-preference-changed", onCustom);
    };
  }, []);

  const toggle = React.useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    window.localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
    window.dispatchEvent(new CustomEvent("particles-preference-changed"));
  }, [enabled]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={toggle}
            aria-pressed={enabled}
            aria-label={enabled ? "Disable particles" : "Enable particles"}
          >
            <Sparkles className={mounted && enabled ? "h-4 w-4" : "h-4 w-4 opacity-40"} />
            <span className="sr-only">Toggle particles</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{enabled ? "Particles on" : "Particles off"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
