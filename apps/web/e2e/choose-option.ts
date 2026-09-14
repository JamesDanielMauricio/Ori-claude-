import { expect, type Locator } from "@playwright/test";

// Picks an option in one of the app's dropdowns. They're the custom Select
// (src/components/ui/select.tsx), not a native <select>, so Playwright's
// selectOption() can't drive them — this does what a person does instead:
// open the dropdown, then click the option by its visible label.
//
// The option is looked up from the page rather than from inside `combobox`'s
// own container: the list is mounted outside the trigger's element (in
// <body>, an open dialog, or a cell popover), never inside its row.
export async function chooseOption(combobox: Locator, label: string) {
  await combobox.click();
  await combobox
    .page()
    .getByRole("listbox")
    .getByRole("option", { name: label, exact: true })
    .click();
  await expect(combobox).toHaveAttribute("aria-expanded", "false");
}
