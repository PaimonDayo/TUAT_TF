"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useLayoutEffect, useRef, type ReactElement, type ReactNode, type RefObject } from "react";
import { glassMenuPosition } from "@/lib/glass-menu-position";

export type GlassMenuItem = {
  key: string;
  label: string;
  icon: ReactNode;
  description?: string;
  destructive?: boolean;
  separator?: boolean;
  /** Clipboard operations must retain the browser's direct user activation. */
  immediate?: boolean;
  onSelect: () => void;
};

/** Anchored action dialog: Radix owns dismissal, focus and scroll-lock handoff. */
export function GlassMenu({ open, onOpenChange, trigger, label, items }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  label: string;
  items: GlassMenuItem[];
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const pending = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; pending.current = null; };
  }, []);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger ref={anchor} asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="system-glass-menu-scrim" />
        <MenuSurface anchor={anchor} label={label} onClosed={() => {
          const action = pending.current;
          pending.current = null;
          if (!alive.current) return;
          // Re-establish the opener before a deferred form mounts. It then owns
          // focus and can restore this same anchor when the form closes.
          anchor.current?.focus({ preventScroll: true });
          action?.();
        }}>
          {items.map((item) => (
            <button key={item.key} type="button" data-menu-item data-destructive={item.destructive || undefined}
              data-separator={item.separator || undefined} className="system-glass-menu-item"
              onClick={() => {
                if (pending.current) return;
                pending.current = item.immediate ? () => anchor.current?.focus({ preventScroll: true }) : item.onSelect;
                if (item.immediate) item.onSelect();
                onOpenChange(false);
              }}>
              <span className="system-glass-menu-icon" aria-hidden="true">{item.icon}</span>
              <span><span>{item.label}</span>{item.description && <span className="system-glass-menu-description">{item.description}</span>}</span>
            </button>
          ))}
        </MenuSurface>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MenuSurface({ anchor, label, onClosed, children }: {
  anchor: RefObject<HTMLButtonElement | null>;
  label: string;
  onClosed: () => void;
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const position = () => {
      const node = content.current, button = anchor.current;
      if (!node || !button) return;
      const v = window.visualViewport;
      const viewport = { left: v?.offsetLeft ?? 0, top: v?.offsetTop ?? 0, width: v?.width ?? innerWidth, height: v?.height ?? innerHeight };
      const p = glassMenuPosition(button.getBoundingClientRect(), viewport, node.scrollHeight + 2);
      Object.assign(node.style, { left: `${p.left}px`, top: `${p.top}px`, width: `${p.width}px`, maxHeight: `${p.maxHeight}px`, transformOrigin: p.origin, visibility: "visible" });
    };
    position();
    const resize = new ResizeObserver(position);
    if (content.current) resize.observe(content.current);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [anchor]);
  return (
    <Dialog.Content ref={content} className="system-glass-menu" aria-describedby={undefined}
      style={{ visibility: "hidden" }}
      onCloseAutoFocus={(event) => { event.preventDefault(); onClosed(); }}
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-menu-item]"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>
      <Dialog.Title className="sr-only">{label}</Dialog.Title>
      {children}
    </Dialog.Content>
  );
}
