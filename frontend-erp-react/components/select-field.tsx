"use client";

import { useCallback, useMemo } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import { cn } from "@/lib/utils";

export interface SelectFieldOption {
  value: string;
  label: string;
}

/**
 * A searchable single-select field built on the shadcn/Base UI Combobox.
 * Drop-in replacement for a plain select: pass `options`, a string `value`,
 * and `onValueChange`. Typing filters the list by label.
 */
export function SelectField({
  options,
  value,
  onValueChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results.",
  disabled,
  id,
  className,
}: {
  options: SelectFieldOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const ids = useMemo(() => options.map((o) => o.value), [options]);
  const labelFor = useCallback(
    (v: string | null) => options.find((o) => o.value === v)?.label ?? "",
    [options],
  );
  const handleValueChange = useCallback(
    (v: unknown) => onValueChange((v as string | null) ?? ""),
    [onValueChange],
  );

  return (
    <Combobox
      items={ids}
      value={value || null}
      onValueChange={handleValueChange}
      itemToStringLabel={labelFor}
      disabled={disabled}
    >
      <ComboboxTrigger
        id={id}
        disabled={disabled}
        className={cn(
          "flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm whitespace-nowrap outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[popup-open]:border-ring dark:bg-input/30",
          className,
        )}
      >
        <ComboboxValue
          placeholder={<span className="text-muted-foreground">{placeholder}</span>}
        >
          {(v: string | null) =>
            v ? (
              <span className="min-w-0 flex-1 truncate text-left">{labelFor(v)}</span>
            ) : (
              <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
                {placeholder}
              </span>
            )
          }
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxContent className="min-w-(--anchor-width)">
        <ComboboxInput showTrigger={false} placeholder={searchPlaceholder} />
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(itemId: string) => (
            <ComboboxItem key={itemId} value={itemId}>
              {labelFor(itemId)}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
