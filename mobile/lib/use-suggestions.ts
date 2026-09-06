import { useEffect, useRef, useState } from "react";

// ============================================================================
// use-suggestions — type-ahead that does not cost anything.
// ----------------------------------------------------------------------------
// Every search bar in the app waited for the return key, and the founder was
// right that it feels broken. The reason it was built that way is that the
// search behind those bars is Google Places Text Search, which bills per call.
//
// So the shape is: this drives a FREE local lookup on every keystroke,
// debounced, and the paid search stays on the explicit submit. The caller
// supplies the fetcher, so nothing here knows which is which — only ever hand
// it a free one.
//
// Two things this gets right that a naive debounce does not:
//   • an answer for a query the user has already typed past is DISCARDED, so a
//     slow response for "chi" cannot overwrite a fast one for "chipotle"
//   • one letter is not a query; it is the whole table
//
// The controller below is deliberately not a hook, so it can be tested with
// fake timers and no renderer. The hook is a thin wrapper over it.
// ============================================================================

export const SUGGEST_DEBOUNCE_MS = 180;
export const SUGGEST_MIN_CHARS = 2;

export type SuggestionController<T> = {
  setQuery: (q: string) => void;
  dispose: () => void;
};

export function createSuggestionController<T>(opts: {
  fetcher: (q: string) => Promise<T[]>;
  onChange: (state: { suggestions: T[]; loading: boolean }) => void;
  minChars?: number;
  debounceMs?: number;
}): SuggestionController<T> {
  const minChars = opts.minChars ?? SUGGEST_MIN_CHARS;
  const debounceMs = opts.debounceMs ?? SUGGEST_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest = "";
  let disposed = false;

  return {
    setQuery(raw: string) {
      const q = raw.trim();
      latest = q;
      if (timer) clearTimeout(timer);
      if (q.length < minChars) {
        opts.onChange({ suggestions: [], loading: false });
        return;
      }
      opts.onChange({ suggestions: [], loading: true });
      timer = setTimeout(() => {
        void opts.fetcher(q)
          .then((rows) => {
            // Typed past this query, or unmounted. Drop the answer.
            if (disposed || latest !== q) return;
            opts.onChange({ suggestions: rows, loading: false });
          })
          .catch(() => {
            if (disposed || latest !== q) return;
            opts.onChange({ suggestions: [], loading: false });
          });
      }, debounceMs);
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export function useSuggestions<T>(
  query: string,
  fetcher: (q: string) => Promise<T[]>,
  opts: { minChars?: number; enabled?: boolean } = {},
): { suggestions: T[]; loading: boolean } {
  const [state, setState] = useState<{ suggestions: T[]; loading: boolean }>({
    suggestions: [], loading: false,
  });

  // Held in a ref so a caller passing an inline arrow does not rebuild the
  // controller on every render and lose its in-flight debounce.
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const ctrl = useRef<SuggestionController<T> | null>(null);
  useEffect(() => {
    ctrl.current = createSuggestionController<T>({
      fetcher: (q) => fetchRef.current(q),
      onChange: setState,
      minChars: opts.minChars,
    });
    return () => { ctrl.current?.dispose(); ctrl.current = null; };
  }, [opts.minChars]);

  const enabled = opts.enabled ?? true;
  useEffect(() => {
    if (!enabled) { setState({ suggestions: [], loading: false }); return; }
    ctrl.current?.setQuery(query);
  }, [query, enabled]);

  return state;
}
