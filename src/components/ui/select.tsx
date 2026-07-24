"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const EMPTY_VALUE = "__select_empty__";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function Select({
  value,
  onValueChange,
  options,
  placeholder = "選択してください",
  ariaLabel,
  disabled,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const normalizedOptions = options.map((option) => ({
    ...option,
    value: option.value === "" ? EMPTY_VALUE : option.value,
  }));
  const normalizedValue = value === "" ? EMPTY_VALUE : value;

  return (
    <SelectPrimitive.Root
      value={normalizedValue}
      onValueChange={(next) => onValueChange(next === EMPTY_VALUE ? "" : next)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          "flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-separator bg-card px-3 text-left text-[15px] outline-none data-[placeholder]:text-muted disabled:opacity-40 lg:h-9 lg:rounded-lg lg:text-[14px]",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown size={17} className="shrink-0 text-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="z-[110] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-separator bg-card shadow-xl"
        >
          <SelectPrimitive.Viewport className="p-1">
            {normalizedOptions.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex min-h-10 cursor-default select-none items-center rounded-lg py-2 pl-3 pr-9 text-[14px] outline-none data-[highlighted]:bg-bg data-[disabled]:opacity-40 lg:min-h-8 lg:py-1.5 lg:text-[13px]"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-3 text-accent">
                  <Check size={17} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
