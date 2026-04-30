// Global type augmentations.

interface PlausibleOptions {
  props?: Record<string, unknown>;
  callback?: () => void;
}

interface UmamiTracker {
  track: (event: string, props?: Record<string, unknown>) => void;
}

interface PostHogLike {
  capture: (event: string, props?: Record<string, unknown>) => void;
}

interface Window {
  plausible?: (event: string, options?: PlausibleOptions) => void;
  umami?: UmamiTracker;
  posthog?: PostHogLike;
}
