import { Select } from "@/components/ui/select";
import { setThemePreference, useThemePreference, type ThemePreference } from "@/lib/theme";

const OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "בהיר" },
  { value: "dark", label: "כהה" },
  { value: "system", label: "מערכת" },
];

// Light / dark / system, as the shared custom Select (ui/select.tsx) — the
// same dropdown idiom every other choice field in the app now wears, rather
// than a one-off control.
//
// Mounted inside the "System settings" dialog (settings-toggles-button.tsx)
// for all three roles, which is why it styles itself with the ordinary
// tokens rather than the sidebar's — the dialog is portalled to <body> and
// resolves to the page's palette for the current theme, not the sidebar's
// (see the palette note in ui/dialog.tsx).
export function ThemeToggle() {
  const preference = useThemePreference();

  return (
    <Select
      aria-label="ערכת צבעים"
      value={preference}
      onChange={(next) => setThemePreference(next as ThemePreference)}
      options={OPTIONS}
      className="w-full"
    />
  );
}
