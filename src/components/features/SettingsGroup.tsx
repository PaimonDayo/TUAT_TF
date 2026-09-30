"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Linked settings open automatically; other groups stay collapsed until requested. */
export function SettingsGroup({ title, id, defaultOpen = false, children }: {
  title: string;
  id?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const revealLinkedGroup = () => {
      if (id && window.location.hash === `#${id}` && ref.current) {
        ref.current.open = true;
        ref.current.scrollIntoView({ block: "start" });
      }
    };
    revealLinkedGroup();
    window.addEventListener("hashchange", revealLinkedGroup);
    return () => window.removeEventListener("hashchange", revealLinkedGroup);
  }, [id]);

  return (
    <details data-ui-section ref={ref} id={id} open={defaultOpen} className="group scroll-mt-20 rounded-card border border-separator/70 bg-card">
      <summary data-ui-disclosure className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-card px-4 py-4 text-[15px] font-semibold focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown size={18} className="shrink-0 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-separator/70">{children}</div>
    </details>
  );
}
