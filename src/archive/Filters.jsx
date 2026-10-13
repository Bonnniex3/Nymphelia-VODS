import { useEffect, useRef, useState } from "react";
import { Search, X, RotateCcw, ChevronDown } from "lucide-react";
import { SORTS } from "../lib/vods";
import { cn } from "../lib/cn";
import Window from "../ui/Window";

export function SearchField({ value, onChange, className }) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  const inputRef = useRef(null);
  const timer = useRef(null);

  // Follow the URL when it changes from elsewhere (reset, back button).
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }

  // Debounce URL writes while typing; clearing applies immediately.
  const commit = (next, immediate = false) => {
    setDraft(next);
    clearTimeout(timer.current);
    if (immediate) onChange(next);
    else timer.current = setTimeout(() => onChange(next), 220);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  // Press "/" anywhere to jump to search.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <label className={cn("group/search relative flex h-11 items-center rounded-2xl border border-line-strong bg-ink/80 transition-colors focus-within:border-petal/70 focus-within:shadow-[0_0_0_4px_rgb(247_143_196/0.12)]", className)}>
      <Search className="ml-3.5 size-4 shrink-0 text-petal" strokeWidth={2.4} />
      <span className="sr-only">Search VOD titles</span>
      <input
        ref={inputRef}
        type="search"
        value={draft}
        onChange={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") commit("", true);
        }}
        placeholder="search titles…"
        className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm text-cream placeholder:font-dot placeholder:text-dim focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {draft ? (
        <button type="button" onClick={() => commit("", true)} aria-label="Clear search" className="mr-2 grid size-7 place-items-center rounded-lg text-mute hover:bg-panel-3 hover:text-cream">
          <X className="size-4" />
        </button>
      ) : (
        <kbd className="mr-3 hidden rounded-md border border-line-strong px-1.5 font-dot text-[11px] text-dim sm:block">/</kbd>
      )}
    </label>
  );
}

function SectionLabel({ children }) {
  return <div className="mb-2 font-dot text-[11px] tracking-[0.25em] text-dim uppercase">// {children}</div>;
}

function RadioRow({ active, onClick, children, count, max }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "group/row flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left font-dot text-[14px] transition-colors",
        active ? "bg-petal/[0.1] text-petal" : "text-blush/75 hover:bg-panel-2 hover:text-cream"
      )}
    >
      <span
        className={cn(
          "size-2 shrink-0 rounded-full border transition-all",
          active ? "border-petal bg-petal shadow-[0_0_10px_rgb(247_143_196/0.9)]" : "border-dim group-hover/row:border-blush"
        )}
      />
      <span className="flex-1 truncate">{children}</span>
      {count != null && (
        <>
          {max ? (
            <span className="flex gap-[3px]" aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className={cn("size-[5px] rounded-full", i < Math.max(1, Math.round((count / max) * 6)) ? (active ? "bg-petal" : "bg-rose") : "bg-panel-3")} />
              ))}
            </span>
          ) : null}
          <span className="w-7 text-right tabular-nums text-mute">{count}</span>
        </>
      )}
    </button>
  );
}

function NativeSelect({ label, value, onChange, options }) {
  return (
    <label className="relative flex h-11 shrink-0 items-center rounded-2xl border border-line-strong bg-ink/80 pr-8 pl-3.5 focus-within:border-petal/70">
      <span className="mr-2 font-dot text-[11px] tracking-widest text-dim uppercase">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="appearance-none bg-transparent font-dot text-[14px] text-petal focus:outline-none">
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-ink text-cream">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 size-4 text-mute" />
    </label>
  );
}

function CategoryChips({ categories, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Type">
      {[{ value: "all", count: null }, ...categories].map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={value === c.value}
          onClick={() => onChange(c.value)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 font-dot text-[13px] transition-all",
            value === c.value
              ? "border-petal bg-petal text-void shadow-[0_0_18px_-4px_rgb(247_143_196/0.9)]"
              : "border-line-strong bg-ink/70 text-blush/80 hover:border-petal/60 hover:text-petal"
          )}
        >
          {c.value}
          {c.count != null && <span className="opacity-60">{c.count}</span>}
        </button>
      ))}
    </div>
  );
}

// Sticky sidebar on wide screens.
export function FilterRail({ state, facets, onChange, onReset, dirty }) {
  const maxYear = Math.max(1, ...facets.years.map((y) => y.count));
  return (
    <Window title="filters.cfg" tone="lilac" controls={false} bodyClassName="flex flex-col gap-6 p-4">
      <SearchField value={state.q} onChange={(q) => onChange({ q })} />
      <div role="radiogroup" aria-label="Sort">
        <SectionLabel>sort</SectionLabel>
        {SORTS.map((s) => (
          <RadioRow key={s.id} active={state.sort === s.id} onClick={() => onChange({ sort: s.id })}>
            {s.label}
          </RadioRow>
        ))}
      </div>
      {facets.years.length > 1 && (
        <div role="radiogroup" aria-label="Year">
          <SectionLabel>year</SectionLabel>
          <RadioRow active={state.year === "all"} onClick={() => onChange({ year: "all" })} count={facets.total}>
            all time
          </RadioRow>
          {facets.years.map((y) => (
            <RadioRow key={y.value} active={String(state.year) === String(y.value)} onClick={() => onChange({ year: String(y.value) })} count={y.count} max={maxYear}>
              {y.value}
            </RadioRow>
          ))}
        </div>
      )}
      {facets.categories.length > 1 && (
        <div>
          <SectionLabel>type</SectionLabel>
          <CategoryChips categories={facets.categories} value={state.category} onChange={(category) => onChange({ category })} />
        </div>
      )}
      <button
        type="button"
        onClick={onReset}
        disabled={!dirty}
        className="flex h-10 items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong font-dot text-[13px] text-mute transition-colors hover:border-petal/60 hover:text-petal disabled:opacity-40"
      >
        <RotateCcw className="size-3.5" /> reset filters
      </button>
    </Window>
  );
}

// Compact toolbar below the xl breakpoint.
export function FilterBar({ state, facets, onChange }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <SearchField value={state.q} onChange={(q) => onChange({ q })} className="sm:flex-1" />
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          <NativeSelect label="sort" value={state.sort} onChange={(sort) => onChange({ sort })} options={SORTS.map((s) => ({ value: s.id, label: s.label }))} />
          {facets.years.length > 1 && (
            <NativeSelect
              label="year"
              value={state.year}
              onChange={(year) => onChange({ year })}
              options={[{ value: "all", label: "all" }, ...facets.years.map((y) => ({ value: String(y.value), label: `${y.value} (${y.count})` }))]}
            />
          )}
        </div>
      </div>
      {facets.categories.length > 1 && <CategoryChips categories={facets.categories} value={state.category} onChange={(category) => onChange({ category })} />}
    </div>
  );
}
