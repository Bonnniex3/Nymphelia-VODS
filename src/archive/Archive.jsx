import { useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { ALL_VODS, archiveStats, facets as getFacets, queryVods } from "../lib/vods";
import { useMediaQuery } from "../lib/hooks";
import { cn } from "../lib/cn";
import { Button } from "../ui/Button";
import { Led } from "../ui/Tag";
import VodCard from "./VodCard";
import EmptyArchive from "./EmptyArchive";
import Pagination from "./Pagination";
import { FilterBar, FilterRail } from "./Filters";

const DEFAULTS = { q: "", sort: "newest", year: "all", cat: "all" };
const FACETS = { ...getFacets(ALL_VODS), total: ALL_VODS.length };
const STATS = archiveStats(ALL_VODS);

function ArchiveHeading({ as: Heading, shown, range }) {
  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
      <div className="flex items-end gap-3">
        <Heading className="font-display text-[clamp(2.2rem,5vw,4rem)] leading-[0.9] font-black tracking-tight lowercase">
          archive<span className="font-dot text-[0.42em] font-normal tracking-normal text-petal text-glow">.dir</span>
        </Heading>
        <span className="mb-1 hidden font-dot text-sm text-mute sm:inline">アーカイブ</span>
      </div>
      <div className="mb-2 hidden h-px min-w-12 flex-1 bg-[radial-gradient(circle,rgb(247_143_196/0.45)_1px,transparent_1.5px)] bg-[length:8px_2px] md:block" aria-hidden="true" />
      <div className="mb-1 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-ink/85 px-2 py-1.5 font-dot text-xs text-mute">
        <Led>{String(STATS.count).padStart(3, "0")}</Led> vods
        <Led tone="sky">{Math.round(STATS.hours)}</Led> hrs
        {shown != null && <span className="ml-1 text-dim">showing {range}</span>}
      </div>
    </div>
  );
}

export default function Archive({ headingAs = "h2", className }) {
  const [params, setParams] = useSearchParams();
  const sectionRef = useRef(null);
  const isWide = useMediaQuery("(min-width: 768px)");
  const hasRail = useMediaQuery("(min-width: 80rem)");
  const pageSize = isWide ? 24 : 12;

  const state = {
    q: params.get("q") ?? DEFAULTS.q,
    sort: params.get("sort") ?? DEFAULTS.sort,
    year: params.get("year") ?? DEFAULTS.year,
    category: params.get("cat") ?? DEFAULTS.cat,
  };
  const results = useMemo(() => queryVods(ALL_VODS, state), [state.q, state.sort, state.year, state.category]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  const page = Math.min(Math.max(1, parseInt(params.get("page") || "1", 10) || 1), totalPages);
  const items = results.slice((page - 1) * pageSize, page * pageSize);
  const dirty = state.q !== DEFAULTS.q || state.sort !== DEFAULTS.sort || state.year !== DEFAULTS.year || state.category !== DEFAULTS.cat;

  const writeParams = (patch) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) {
          if (value == null || value === "" || value === DEFAULTS[key] || (key === "page" && value === 1)) next.delete(key);
          else next.set(key, String(value));
        }
        return next;
      },
      { replace: true, preventScrollReset: true }
    );

  const onChange = ({ category, ...rest }) => writeParams({ ...rest, ...(category !== undefined && { cat: category }), page: 1 });
  const onReset = () => writeParams({ q: "", sort: "newest", year: "all", cat: "all", page: 1 });
  const onPage = (p) => {
    writeParams({ page: p });
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const isEmpty = ALL_VODS.length === 0;
  const range = results.length ? `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + items.length} of ${results.length}` : "0";

  return (
    <section id="archive" ref={sectionRef} aria-label="VOD archive" className={cn("scroll-mt-[calc(var(--topbar-h)+1rem)]", className)}>
      <ArchiveHeading as={headingAs} shown={isEmpty ? null : results.length} range={range} />

      {isEmpty ? (
        <EmptyArchive />
      ) : (
        <div className="mt-6 grid gap-5 xl:grid-cols-[272px_minmax(0,1fr)] 3xl:grid-cols-[300px_minmax(0,1fr)]">
          {hasRail && (
            <aside>
              <div className="sticky top-[calc(var(--topbar-h)+1.25rem)]">
                <FilterRail state={state} facets={FACETS} onChange={onChange} onReset={onReset} dirty={dirty} />
              </div>
            </aside>
          )}

          <div className="min-w-0">
            {!hasRail && (
              <div className="mb-5">
                <FilterBar state={state} facets={FACETS} onChange={onChange} />
              </div>
            )}

            {items.length === 0 ? (
              <div className="grid min-h-80 place-items-center rounded-[20px] border border-dashed border-line-strong bg-panel/40 p-10 text-center">
                <div>
                  <p className="font-dot text-3xl text-petal">(｡•́︿•̀｡)</p>
                  <p className="mt-4 font-display text-xl font-bold">no vods match that</p>
                  <p className="mt-1 text-mute">Try a different search or clear the filters.</p>
                  <Button className="mt-5" variant="ghost" onClick={onReset}>
                    reset filters
                  </Button>
                </div>
              </div>
            ) : (
              <div
                key={`${state.q}|${state.sort}|${state.year}|${state.category}|${page}`}
                className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,272px),1fr))] gap-4 3xl:gap-5"
              >
                {items.map((vod, i) => (
                  <motion.div
                    key={vod.id}
                    initial={{ opacity: 0, y: 18, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.45, delay: Math.min(i, 12) * 0.035, ease: [0.2, 0.8, 0.2, 1] }}
                  >
                    <VodCard vod={vod} className="h-full" />
                  </motion.div>
                ))}
              </div>
            )}

            <div className="mt-10">
              <Pagination page={page} totalPages={totalPages} onPage={onPage} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
