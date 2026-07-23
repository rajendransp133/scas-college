"use client";

import { useEffect, useState } from "react";

/**
 * Debounce a rapidly-changing value (a search box) before it reaches a query.
 *
 * Without this, every keystroke is a request and a new React Query cache
 * entry. The input itself stays controlled and instant — only the *fetch* is
 * delayed — so typing never feels laggy.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
