import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface MaisonSelectOption {
  value: string;
  label: string;
}

/**
 * Styled replacement for a native <select>. The browser's own dropdown panel
 * cannot be themed, so the closed control renders as the same underline field
 * the search box uses, and the open list is a glass panel (design canon:
 * glassmorphism on all overlays/dropdowns/menus). Accessible listbox
 * behaviour: ArrowUp/Down, Home/End, Enter/Space, Escape, Tab-out, click-out.
 * The empty value ("") is always the first option, labelled `placeholder`.
 */
export function MaisonSelect({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: MaisonSelectOption[];
  placeholder: string;
}) {
  const all: MaisonSelectOption[] = [{ value: "", label: placeholder }, ...options];
  // A URL-supplied value can arrive before its option list loads — show the
  // raw slug for that beat rather than mislabelling the filter as inactive.
  const selected = all.find((o) => o.value === value) ?? { value, label: value };
  const currentIndex = Math.max(0, all.findIndex((o) => o.value === value));

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    (listRef.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({
      block: "nearest",
    });
  }, [open, active]);

  const openList = () => {
    setActive(currentIndex);
    setOpen(true);
  };
  const commit = (index: number) => {
    onChange(all[index].value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (open) commit(active);
        else openList();
        break;
      case "ArrowDown":
        e.preventDefault();
        if (open) setActive((a) => Math.min(all.length - 1, a + 1));
        else openList();
        break;
      case "ArrowUp":
        e.preventDefault();
        if (open) setActive((a) => Math.max(0, a - 1));
        else openList();
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          setActive(all.length - 1);
        }
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <label
        id={`${id}-label`}
        htmlFor={id}
        className="text-[0.65rem] tracking-[0.35em] uppercase text-taupe"
      >
        {label}
      </label>
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}`}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${listboxId}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className="mt-2 flex w-full items-center justify-between gap-2 border-b border-taupe/30 py-2 text-left text-cream transition-colors hover:border-taupe/60 focus:border-taupe focus:outline-none"
      >
        <span className={`truncate ${value ? "" : "text-cream/55"}`}>{selected.label}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-taupe transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={`${id}-label`}
          className="absolute left-0 right-0 top-full z-30 mt-2 max-h-72 overflow-auto border border-taupe/20 bg-ink/90 shadow-[0_24px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl"
        >
          {all.map((o, i) => (
            <li
              key={o.value || "__all"}
              id={`${listboxId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              onPointerEnter={() => setActive(i)}
              // Keep focus on the trigger so keyboard interaction survives a
              // mouse pick (focus never enters the list).
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => commit(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-body-sm transition-colors ${
                i === active ? "bg-taupe/10 text-cream" : "text-cream/75"
              }`}
            >
              <span className="truncate">{o.label}</span>
              {o.value === value ? <Check className="h-3.5 w-3.5 shrink-0 text-taupe" /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
