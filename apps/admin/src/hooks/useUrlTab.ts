import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * URL-driven tab state.
 *
 * The active tab rides in the `?tab=` query param so it is **deep-linkable**
 * (the ⌘K command palette's tab search navigates straight to `/module?tab=x`)
 * and survives the unmount/remount that happens when navigating back into a
 * page — the pattern the Catalogue page documents as the house style
 * ("Tab lives in the URL (not component state)…").
 *
 * Drop-in compatible with `useState`: returns `[active, setActive]`, so a page
 * that had `const [tab, setTab] = useState<T>("x")` becomes
 * `const [tab, setTab] = useUrlTab<T>("x", KEYS)` with no other changes — every
 * existing `setTab(key)` call keeps working, it just also updates the URL.
 *
 * The default tab is represented as the *absence* of `?tab=` so landing routes
 * stay clean (`/catalogue`, not `/catalogue?tab=styled`). An unknown / stale
 * `?tab=` value falls back to the default when an allow-list is supplied.
 *
 * @param defaultTab the tab shown when `?tab=` is absent or holds an unknown key
 * @param valid      optional allow-list of tab keys; guards against stale URLs
 */
export function useUrlTab<T extends string>(
  defaultTab: T,
  valid?: readonly T[],
): [T, (t: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const active = (
    raw && (!valid || (valid as readonly string[]).includes(raw))
      ? raw
      : defaultTab
  ) as T;

  const setActive = useCallback(
    (t: T) => {
      setParams(
        (prev) => {
          // Merge, never clobber — a page may keep other params in the URL.
          const next = new URLSearchParams(prev);
          if (t === defaultTab) next.delete("tab");
          else next.set("tab", t);
          return next;
        },
        { replace: true },
      );
    },
    [setParams, defaultTab],
  );

  return [active, setActive];
}
