import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { inputClassName } from "@/components/reference-data/form-field";
import { Icon } from "@/components/ui/icon";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const PANEL_GAP = 4;
const VIEWPORT_MARGIN = 8;
// Tallest the list grows before it scrolls — 16rem.
const PANEL_MAX_HEIGHT = 256;

// Where the list is mounted: the nearest of these around the trigger, else
// <body>.
//
// An open modal <dialog> sits in the browser's "top layer" — drawn above the
// rest of the page whatever its z-index — and makes everything outside itself
// unclickable. A list mounted in <body> from inside the settings dialog was
// drawn underneath the dialog and could never be clicked, so inside a dialog
// it has to be mounted in the dialog itself.
//
// `data-portal-root` marks a floating panel that closes on outside clicks
// (CellPopover). Mounted in <body>, picking an option counted as a click
// outside that panel, which closed it — taking this list with it — before the
// option could be chosen.
const PORTAL_ROOT_SELECTOR = "dialog[open], [data-portal-root]";

// A custom listbox in place of the native <select>, whose dropdown is drawn by
// the operating system and can't be styled. The trigger wears the same
// `inputClassName` skin as every other field (form-field.tsx); the list is a
// floating panel styled like the app's other panels.
//
// Focus stays on the trigger the whole time — `aria-activedescendant` tells
// assistive tech which option is highlighted — so the arrow keys, Home/End,
// type-ahead and Enter all work from the trigger's own key handler.
export function Select({
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
  id,
  disabled = false,
  className = "",
  // Order-product-list's quantity pill draws its own leading icon and
  // trailing unit label around the trigger and doesn't want a second,
  // built-in chevron competing with them.
  showChevron = true,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  "aria-label"?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  showChevron?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [portalRoot, setPortalRoot] = useState<Element | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  // Buffered type-ahead: letters typed within 600ms of each other accumulate
  // into one search term, the same window a native <select> uses, instead of
  // each keystroke restarting the search from scratch.
  const typeaheadRef = useRef({ text: "", timer: 0 as unknown as ReturnType<typeof setTimeout> });

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex === -1 ? undefined : options[selectedIndex];

  function openPanel() {
    const trigger = triggerRef.current;
    if (disabled || options.length === 0 || !trigger) return;
    setPortalRoot(trigger.closest(PORTAL_ROOT_SELECTOR) ?? document.body);
    setHighlighted(selectedIndex === -1 ? 0 : selectedIndex);
    setOpen(true);
  }

  function closePanel(focusTrigger = false) {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }

  function commit(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    closePanel(true);
  }

  // Positions the list against its trigger. Written straight onto the panel's
  // style rather than kept in state: it re-runs on every scroll frame while
  // open, and none of it changes what React renders. A layout effect, so it
  // runs before the first paint and the list never flashes in the wrong spot.
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!open || !trigger || !panel) return;

    const place = () => {
      const rect = trigger.getBoundingClientRect();
      // The trigger has scrolled out of view — close rather than leave a list
      // floating with nothing to point at.
      if (
        rect.bottom < 0 ||
        rect.top > window.innerHeight ||
        rect.right < 0 ||
        rect.left > window.innerWidth
      ) {
        setOpen(false);
        return;
      }

      panel.style.width = `${rect.width}px`;
      // Full height of the options whatever max-height is applied right now
      // (scrollHeight), plus the border (offsetHeight − clientHeight).
      const naturalHeight = Math.min(
        panel.scrollHeight + panel.offsetHeight - panel.clientHeight,
        PANEL_MAX_HEIGHT,
      );
      const spaceBelow = window.innerHeight - rect.bottom - PANEL_GAP - VIEWPORT_MARGIN;
      const spaceAbove = rect.top - PANEL_GAP - VIEWPORT_MARGIN;
      // Opens upward only when the list doesn't fit below and there's more
      // room above. Always opening downward ran the list off the bottom of
      // the screen for triggers near it, like the lower rows of the order form.
      const upward = naturalHeight > spaceBelow && spaceAbove > spaceBelow;
      const maxHeight = Math.max(0, Math.min(PANEL_MAX_HEIGHT, upward ? spaceAbove : spaceBelow));
      const height = Math.min(naturalHeight, maxHeight);

      panel.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - VIEWPORT_MARGIN - rect.width))}px`;
      panel.style.top = `${upward ? rect.top - PANEL_GAP - height : rect.bottom + PANEL_GAP}px`;
      panel.style.maxHeight = `${maxHeight}px`;
    };

    // Follows the trigger when anything scrolls — the page, the record table's
    // horizontal scroller, a dialog's body — instead of staying pinned where
    // it opened. Scroll events don't bubble, so this listens in the capture
    // phase to hear every scroll container; the list's own scrolling is
    // ignored.
    const handleScroll = (event: Event) => {
      if (event.target instanceof Node && panel.contains(event.target)) return;
      place();
    };

    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, options.length]);

  // Outside-click close.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  // Escape closes just this list. Listened for on window in the capture phase
  // — the very first place a key event arrives — so it runs ahead of every
  // other Escape handler this dropdown can sit inside: CellPopover's (document,
  // capture), the record table's "cancel the row edit" (window, bubble), and a
  // modal <dialog>'s own close-on-Escape. Stopping it here is what keeps one
  // press from closing all of them at once.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open]);

  // Keeps the highlighted option in view as the arrow keys move past the
  // list's scroll edge. Scrolls the list only: scrollIntoView() would also
  // scroll whatever the list sits inside (the page, a dialog, a popover) to
  // chase an option that's already on screen.
  useEffect(() => {
    const panel = panelRef.current;
    const option = open ? document.getElementById(`${listId}-${highlighted}`) : null;
    if (!panel || !option) return;
    const padding = parseFloat(getComputedStyle(panel).paddingTop);
    const top = option.offsetTop - padding;
    const bottom = option.offsetTop + option.offsetHeight + padding;
    if (top < panel.scrollTop) panel.scrollTop = top;
    else if (bottom > panel.scrollTop + panel.clientHeight) {
      panel.scrollTop = bottom - panel.clientHeight;
    }
  }, [open, highlighted, listId]);

  function moveHighlight(delta: number) {
    if (options.every((option) => option.disabled)) return;
    setHighlighted((current) => {
      let next = current;
      for (let step = 0; step < options.length; step++) {
        next = (next + delta + options.length) % options.length;
        if (!options[next]?.disabled) break;
      }
      return next;
    });
  }

  function handleTypeahead(key: string) {
    const state = typeaheadRef.current;
    window.clearTimeout(state.timer);
    state.text += key.toLocaleLowerCase();
    state.timer = setTimeout(() => {
      state.text = "";
    }, 600);

    const match = options.find(
      (option) => !option.disabled && option.label.toLocaleLowerCase().startsWith(state.text),
    );
    if (!match) return;
    if (open) setHighlighted(options.indexOf(match));
    else onChange(match.value);
  }

  // Escape isn't here — see the window listener above.
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) openPanel();
        else moveHighlight(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) openPanel();
        else moveHighlight(-1);
        break;
      case "Home":
        if (!open) break;
        event.preventDefault();
        setHighlighted(options.findIndex((option) => !option.disabled));
        break;
      case "End":
        if (!open) break;
        event.preventDefault();
        for (let index = options.length - 1; index >= 0; index--) {
          if (!options[index]?.disabled) {
            setHighlighted(index);
            break;
          }
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) commit(highlighted);
        else openPanel();
        break;
      case "Tab":
        if (open) closePanel();
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          handleTypeahead(event.key);
        }
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        // Only while the list exists — an id reference to an element that
        // isn't in the page is an accessibility error.
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${highlighted}` : undefined}
        onClick={() => (open ? closePanel() : openPanel())}
        onKeyDown={handleKeyDown}
        className={`${inputClassName} flex items-center justify-between gap-2 text-start ${className}`}
      >
        <span className="truncate">{selectedOption?.label ?? value}</span>
        {showChevron && (
          <Icon
            name="chevronDown"
            className={`h-3.5 w-3.5 shrink-0 text-ink-subtle transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
          />
        )}
      </button>

      {open &&
        portalRoot &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            id={listId}
            aria-label={ariaLabel}
            className="fixed z-50 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 text-ink shadow-overlay"
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              const isHighlighted = index === highlighted;
              return (
                <div
                  key={option.value}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  onMouseEnter={() => !option.disabled && setHighlighted(index)}
                  onClick={() => commit(index)}
                  // `py-2.5` makes each option 40px tall rather than 36. This
                  // list is how a customer picks every quantity on the order
                  // screen, so on a phone it is one of the most-tapped
                  // surfaces in the app, and its rows sit directly against
                  // each other with no gap to absorb a near miss.
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2.5 text-sm transition-colors duration-150 ${
                    option.disabled
                      ? "cursor-not-allowed text-ink-subtle opacity-50"
                      : isHighlighted
                        ? "bg-accent-soft text-accent"
                        : "text-ink hover:bg-surface-muted"
                  }`}
                >
                  <span className="truncate">{option.label}</span>
                  {isSelected && <Icon name="check" className="h-4 w-4 shrink-0 text-accent" />}
                </div>
              );
            })}
          </div>,
          portalRoot,
        )}
    </>
  );
}
