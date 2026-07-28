import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Open the record a deep link points at.
 *
 * Notifications and tasks link straight to a record —
 * `/stock?tab=adjustments&adjustment=<id>`, `/cash-requests?...&request=<id>`
 * — so an approver lands on the thing they must decide on instead of a list
 * they have to search. This hook is the receiving half of that contract:
 * it reads the id from the URL, finds the row once the list has loaded, hands
 * it to the page's existing "open the drawer" state, and clears the param.
 *
 * Why clear it: the drawer is now owned by component state, so leaving the id
 * in the URL means closing the drawer and re-rendering re-opens it, and a
 * later Back lands on a stale record. The param is a one-shot instruction,
 * not a piece of page state (that is what `?tab=` is for).
 *
 * Deliberately waits for the row rather than fetching it: every page that
 * uses this already lists the records, and its drawer takes the full object.
 * If the row isn't in the loaded page (an old record on page 7), nothing
 * opens — the param is still cleared, so the user sees the list rather than a
 * spinner that never resolves.
 *
 * @param param  query-string key, e.g. "adjustment"
 * @param rows   the currently-loaded records
 * @param getId  how to read a row's id
 * @param onOpen called once with the matching row
 */
export function useDeepLinkedRecord<T>(
  param: string,
  rows: T[] | undefined,
  getId: (row: T) => string,
  onOpen: (row: T) => void,
): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const target = searchParams.get(param);
  // One open per id: without this, a list refetch (TanStack refocus, a
  // mutation invalidating the query) would re-open a drawer the user closed.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!target || handled.current === target) return;
    if (!rows || rows.length === 0) return; // still loading — try again on data

    const match = rows.find((r) => getId(r) === target);
    handled.current = target;

    if (match) onOpen(match);

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(param);
        return next;
      },
      { replace: true },
    );
    // getId/onOpen are stable enough in practice (defined inline in the page);
    // depending on them would re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, rows, param, setSearchParams]);
}
