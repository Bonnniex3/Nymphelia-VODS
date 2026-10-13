import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";

function pageList(current, total) {
  const pages = [...new Set([1, total, current - 1, current, current + 1])].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) out.push(`gap-${p}`);
    out.push(p);
  });
  return out;
}

const pad = (n) => String(n).padStart(2, "0");

export default function Pagination({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null;
  const btn = "grid h-10 min-w-10 place-items-center rounded-xl border px-2 font-dot text-[14px] tabular-nums transition-all";
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-center gap-1.5">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page" className={cn(btn, "border-line-strong bg-ink/70 text-blush/80 hover:border-petal/60 hover:text-petal disabled:opacity-30")}>
        <ChevronLeft className="size-4" />
      </button>
      {pageList(page, totalPages).map((p) =>
        typeof p === "string" ? (
          <span key={p} className="px-1 font-dot text-dim" aria-hidden="true">
            ···
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            aria-current={p === page ? "page" : undefined}
            aria-label={`Page ${p}`}
            className={cn(
              btn,
              p === page
                ? "border-petal bg-petal/[0.14] text-petal text-glow shadow-[0_0_20px_-6px_rgb(247_143_196/0.8)]"
                : "border-line bg-ink/60 text-blush/70 hover:border-petal/50 hover:text-cream"
            )}
          >
            {pad(p)}
          </button>
        )
      )}
      <button type="button" onClick={() => onPage(page + 1)} disabled={page >= totalPages} aria-label="Next page" className={cn(btn, "border-line-strong bg-ink/70 text-blush/80 hover:border-petal/60 hover:text-petal disabled:opacity-30")}>
        <ChevronRight className="size-4" />
      </button>
      <span className="ml-2 font-dot text-[12px] text-dim">
        pg {pad(page)}/{pad(totalPages)}
      </span>
    </nav>
  );
}
