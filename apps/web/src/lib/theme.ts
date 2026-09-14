import { useSyncExternalStore } from "react";

// Light / dark / system colour theme.
//
// Three choices, but only two ways to paint: the page is always either light
// or dark. "system" is a *preference* that resolves to one of those by asking
// the OS (`prefers-color-scheme`) — and keeps asking, so if the OS switches at
// sunset the app switches with it.
//
// The resolved theme is written to <html data-theme="light|dark">, and that
// attribute is the only thing the stylesheet reads (see the theme blocks in
// globals.css). Resolving "system" here, in JS, is what lets globals.css hold
// ONE dark palette — otherwise it would need a second copy of every dark value
// inside a `prefers-color-scheme` media query.
//
// Stored per browser in localStorage, not per account in the database:
// "system" only means something on a particular device, and a phone in dark
// mode next to a desktop in light mode is exactly the case where one account
// wants two different answers. (It also means no migration.)

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

// index.html's inline pre-paint script reads this same key — rename one,
// rename both.
export const THEME_STORAGE_KEY = "ori-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

// Anything other than the three known words — no saved value yet, a value
// from some future build, a hand-edited entry — falls back to "system", the
// one answer that can't be wrong for someone who never picked.
export function parseThemePreference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

// ---- The store -------------------------------------------------------------
// A module-level value rather than React state, because more than one toggle
// can be mounted at once (the desktop rail is always in the DOM, just hidden
// on phones, and the mobile menu mounts its own copy). Both read this one
// value through useSyncExternalStore, so they can never disagree.

let current: ThemePreference = "system";
const listeners = new Set<() => void>();

function readStoredPreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // localStorage can throw outright (blocked site data, some private modes).
    return "system";
  }
}

function paint() {
  const systemPrefersDark = window.matchMedia(DARK_QUERY).matches;
  document.documentElement.dataset.theme = resolveTheme(current, systemPrefersDark);
}

// Switching theme with CSS transitions live makes every button, input and nav
// row fade to its new colour at its own speed while cards and text snap
// instantly — the page visibly "ripples". So transitions are switched off
// (globals.css, `[data-theme-switching]`) for the one frame where the colours
// change, and the whole page changes at once.
function paintWithoutTransitions() {
  const root = document.documentElement;
  root.setAttribute("data-theme-switching", "");
  paint();
  // Reading a layout value forces the browser to apply the new colours right
  // now, while transitions are still off — so they become the starting point
  // and nothing animates when transitions come back on.
  void document.body.offsetHeight;
  requestAnimationFrame(() => root.removeAttribute("data-theme-switching"));
}

// Called once from main.tsx, before React renders. index.html has already
// painted the right theme (that's what prevents a flash); this takes over from
// there — loads the same saved preference into the store, and follows the OS
// for as long as the preference is "system".
export function initTheme() {
  current = readStoredPreference();
  paint();
  window.matchMedia(DARK_QUERY).addEventListener("change", () => {
    if (current === "system") paintWithoutTransitions();
  });
}

export function setThemePreference(next: ThemePreference) {
  current = next;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Not saved for next time, but still applied for this visit.
  }
  paintWithoutTransitions();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, () => current);
}
