import React, {
  createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef,
} from "react";
import {
  ScrollView, View,
  type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent,
  type ScrollViewProps, type ViewProps,
} from "react-native";

// ============================================================================
// Impressions — "was this actually on screen?"
// ----------------------------------------------------------------------------
// `rec_restaurant_viewed` used to fire for the whole top-30 the moment the
// data loaded. 1,526 "views" that never meant seen, and every downstream
// number that divides by views (click-through, save rate, skip = viewed but
// not clicked) was built on them. There is no IntersectionObserver in React
// Native and the lists live inside a ScrollView, not a FlatList, so viewability
// is measured by hand: the ScrollView publishes its offset and height; each
// card measures itself against the ScrollView's content and reports once,
// after it has been at least half visible for `dwellMs`.
//
// Half-visible for half a second is the same bar the ad industry settled on
// for a viewable impression. Below it, a card scrolled past at speed counts
// as seen, and "seen but not clicked" starts to look like a rejection.
// ============================================================================

type Viewport = { y: number; h: number };

type Ctx = {
  scroll: React.RefObject<ScrollView | null>;
  viewport: React.MutableRefObject<Viewport>;
  subscribe: (fn: () => void) => () => void;
};

const ImpressionCtx = createContext<Ctx | null>(null);

/** Drop-in for ScrollView. Anything rendered inside can wrap itself in
 *  <Impression> and be told when it has genuinely been looked at. */
export const ImpressionScrollView = forwardRef<ScrollView, ScrollViewProps>(
  function ImpressionScrollView(props, fwd) {
    const scroll = useRef<ScrollView | null>(null);
    const viewport = useRef<Viewport>({ y: 0, h: 0 });
    const subs = useRef(new Set<() => void>());
    const notify = () => { subs.current.forEach((fn) => fn()); };

    const setRef = useCallback((node: ScrollView | null) => {
      scroll.current = node;
      if (typeof fwd === "function") fwd(node);
      else if (fwd) (fwd as React.MutableRefObject<ScrollView | null>).current = node;
    }, [fwd]);

    const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      viewport.current = {
        y: e.nativeEvent.contentOffset.y,
        h: e.nativeEvent.layoutMeasurement.height,
      };
      props.onScroll?.(e);
      notify();
    };
    const onLayout = (e: LayoutChangeEvent) => {
      viewport.current = { ...viewport.current, h: e.nativeEvent.layout.height };
      props.onLayout?.(e);
      notify();
    };

    const ctx = useMemo<Ctx>(() => ({
      scroll,
      viewport,
      subscribe: (fn) => { subs.current.add(fn); return () => { subs.current.delete(fn); }; },
    }), []);

    return (
      <ImpressionCtx.Provider value={ctx}>
        <ScrollView
          {...props}
          ref={setRef}
          onScroll={onScroll}
          onLayout={onLayout}
          // 100ms is plenty for "did it sit there for half a second", and
          // keeps the bridge quiet while the user flicks.
          scrollEventThrottle={props.scrollEventThrottle ?? 100}
        />
      </ImpressionCtx.Provider>
    );
  },
);

// One impression per place per surface per session window. Switching Discover
// tabs and back remounts every card; that is not a second look at the place.
const SEEN_WINDOW_MS = 10 * 60 * 1000;
const seenAt = new Map<string, number>();

/** Test seam: forget everything seen. */
export function resetImpressionsForTest(): void { seenAt.clear(); }

/** Pure visibility maths, exported so it can be tested without a renderer. */
export function visibleFraction(box: { y: number; h: number }, vp: Viewport): number {
  if (box.h <= 0 || vp.h <= 0) return 0;
  const top = Math.max(box.y, vp.y);
  const bottom = Math.min(box.y + box.h, vp.y + vp.h);
  return Math.max(0, bottom - top) / box.h;
}

export function Impression({
  id,
  surface,
  onSeen,
  minVisible = 0.5,
  dwellMs = 500,
  children,
  ...viewProps
}: ViewProps & {
  /** Identity of the thing being looked at (google_place_id). */
  id: string;
  /** Which list it is in; the same place on two lists is two impressions. */
  surface?: string;
  onSeen: () => void;
  minVisible?: number;
  dwellMs?: number;
}) {
  const ctx = useContext(ImpressionCtx);
  const ref = useRef<View | null>(null);
  const box = useRef<{ y: number; h: number } | null>(null);
  const done = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMeasure = useRef(0);
  const key = `${surface ?? "unknown"}:${id}`;

  const fire = useCallback(() => {
    if (done.current) return;
    done.current = true;
    const last = seenAt.get(key) ?? 0;
    const now = Date.now();
    if (now - last < SEEN_WINDOW_MS) return;
    seenAt.set(key, now);
    try { onSeen(); } catch { /* an impression must never take the list down */ }
  }, [key, onSeen]);

  const check = useCallback(() => {
    if (done.current || !ctx || !box.current) return;
    const frac = visibleFraction(box.current, ctx.viewport.current);
    if (frac >= minVisible) {
      if (!timer.current) timer.current = setTimeout(() => { timer.current = null; fire(); }, dwellMs);
    } else if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, [ctx, minVisible, dwellMs, fire]);

  const measure = useCallback(() => {
    if (done.current || !ctx) return;
    const node = ref.current;
    const inner = (ctx.scroll.current as any)?.getInnerViewNode?.();
    if (!node || !inner) return;
    lastMeasure.current = Date.now();
    node.measureLayout(inner, (_x, y, _w, h) => { box.current = { y, h }; check(); }, () => {});
  }, [ctx, check]);

  useEffect(() => {
    if (!ctx) {
      // Rendered outside an ImpressionScrollView. Saying nothing is better
      // than reviving the fire-on-mount lie, but it should not go unnoticed.
      if (__DEV__) console.warn(`<Impression> for ${key} has no ImpressionScrollView above it`);
      return;
    }
    const unsub = ctx.subscribe(() => {
      if (done.current) return;
      // Our own onLayout only fires when OUR frame changes. A note appearing
      // above the list moves every card without telling any of them, so the
      // position is refreshed on scroll, at most a few times a second.
      if (Date.now() - lastMeasure.current > 400) measure(); else check();
    });
    return () => {
      unsub();
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    };
  }, [ctx, key, measure, check]);

  return (
    <View
      {...viewProps}
      ref={ref}
      onLayout={(e) => { viewProps.onLayout?.(e); measure(); }}
    >
      {children}
    </View>
  );
}
