"use client";

import { CornerDownLeftIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type AdminPaletteItem = {
  id: string;
  label: string;
  hint?: string;
  href: string;
  group: string;
  keywords?: string;
};

const VIEW_ITEMS: AdminPaletteItem[] = [
  {
    id: "view-overview",
    label: "Overview",
    hint: "Command center: what needs attention now",
    href: "/admin/session-review?view=today",
    group: "Views",
    keywords: "home today command center executive",
  },
  {
    id: "view-enquiries",
    label: "Enquiries",
    hint: "CRM pipeline, records, and accounts",
    href: "/admin/session-review?view=leads",
    group: "Views",
    keywords: "leads pipeline crm records accounts owners",
  },
  {
    id: "view-reka",
    label: "Reka quality",
    hint: "Conversation scores and fixes",
    href: "/admin/session-review?view=reka",
    group: "Views",
    keywords: "evals quality learning scores",
  },
  {
    id: "view-voice",
    label: "Voice diagnostics",
    hint: "Transcripts, timings, errors, cost",
    href: "/admin/session-review?view=voice",
    group: "Views",
    keywords: "realtime runtime sessions transcripts latency debug",
  },
  {
    id: "view-audit",
    label: "Activity & audit",
    hint: "Trends, sources, and the event trail",
    href: "/admin/session-review?view=audit",
    group: "Views",
    keywords: "insights analytics events audit history",
  },
  {
    id: "jump-follow-ups",
    label: "Voice follow-ups",
    hint: "Gave details, never finished sending",
    href: "/admin/session-review?view=voice#voice-recovery",
    group: "Jump to",
    keywords: "recoverable unsent follow up email back",
  },
  {
    id: "jump-pipeline",
    label: "Enquiry pipeline table",
    hint: "Sortable CRM table of all enquiries",
    href: "/admin/session-review?view=leads#crm-workspace",
    group: "Jump to",
    keywords: "table crm sort attention queue",
  },
  {
    id: "jump-accounts",
    label: "Account portfolio",
    hint: "Organizations and owner workload",
    href: "/admin/session-review?view=leads#crm-accounts",
    group: "Jump to",
    keywords: "accounts organizations owners workload",
  },
];

const GROUP_ORDER = ["Views", "Jump to", "Leads", "Voice sessions"];

function scoreItem(item: AdminPaletteItem, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const label = item.label.toLowerCase();
  const haystack = `${label} ${item.hint?.toLowerCase() ?? ""} ${item.keywords?.toLowerCase() ?? ""}`;
  if (label.startsWith(q)) return 4;
  if (label.includes(q)) return 3;
  if (haystack.includes(q)) return 2;
  // Loose word match: every query word appears somewhere.
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((word) => haystack.includes(word))) return 1;
  return 0;
}

export function AdminCommandPalette({ items = [] }: { items?: AdminPaletteItem[] }) {
  const [open, setOpen] = useState(false);
  const [shortcutHint, setShortcutHint] = useState("Ctrl K");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const allItems = useMemo(() => [...VIEW_ITEMS, ...items], [items]);

  const results = useMemo(() => {
    const scored = allItems
      .map((item) => ({ item, score: scoreItem(item, query) }))
      .filter((entry) => entry.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || GROUP_ORDER.indexOf(left.item.group) - GROUP_ORDER.indexOf(right.item.group),
      );
    // Without a query show navigation only; with one, cap the noise.
    const visible = query.trim()
      ? scored.slice(0, 24)
      : scored.filter((e) => e.item.group !== "Voice sessions").slice(0, 14);
    const grouped: Array<{ group: string; items: AdminPaletteItem[] }> = [];
    for (const group of GROUP_ORDER) {
      const groupItems = visible.filter((entry) => entry.item.group === group).map((entry) => entry.item);
      if (groupItems.length > 0) grouped.push({ group, items: groupItems });
    }
    return grouped;
  }, [allItems, query]);

  const flat = useMemo(() => results.flatMap((section) => section.items), [results]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelected(0);
  }, []);

  const navigate = useCallback(
    (item: AdminPaletteItem | undefined) => {
      if (!item) return;
      close();
      window.location.href = item.href;
    },
    [close],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (event.key === "/" && !open) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (/mac|iphone|ipad/i.test(navigator.platform)) setShortcutHint("⌘K");
  }, []);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <>
      <button
        className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-slate-400 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-slate-200"
        onClick={() => setOpen(true)}
        type="button"
      >
        <SearchIcon className="size-3.5" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-sans text-[10px] font-semibold text-slate-500 sm:inline">
          {shortcutHint}
        </kbd>
      </button>
      {open ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[#04060c]/70 p-4 backdrop-blur-sm"
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelected((value) => Math.min(value + 1, flat.length - 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((value) => Math.max(value - 1, 0));
            }
            if (event.key === "Enter") {
              event.preventDefault();
              navigate(flat[selected]);
            }
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          role="dialog"
        >
          <div className="admin-palette mx-auto mt-[10vh] w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#0b101e]/95 shadow-[0_32px_120px_-24px_rgba(0,0,0,0.95),0_0_0_1px_rgba(138,176,255,0.08)]">
            <div className="flex items-center gap-3 border-b border-white/10 px-4">
              <SearchIcon className="size-4 shrink-0 text-slate-500" />
              <input
                aria-label="Search the admin console"
                className="h-13 w-full bg-transparent py-4 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelected(0);
                }}
                placeholder="Jump to a lead, voice session, queue, or view..."
                ref={inputRef}
                value={query}
              />
              <kbd className="rounded border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-sans text-[10px] font-semibold text-slate-500">
                esc
              </kbd>
            </div>
            <div className="max-h-[46vh] overflow-y-auto p-2" ref={listRef}>
              {flat.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-slate-500">No matches for “{query}”.</p>
              ) : (
                results.map((section) => (
                  <div key={section.group}>
                    <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                      {section.group}
                    </div>
                    {section.items.map((item) => {
                      const index = flat.indexOf(item);
                      const active = index === selected;
                      return (
                        <button
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                            active ? "bg-sky-400/10 text-slate-100" : "text-slate-300 hover:bg-white/[0.04]"
                          }`}
                          data-index={index}
                          key={item.id}
                          onClick={() => navigate(item)}
                          onMouseMove={() => setSelected(index)}
                          type="button"
                        >
                          <span
                            className={`size-1.5 shrink-0 rounded-full ${active ? "bg-sky-400" : "bg-slate-600"}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{item.label}</span>
                            {item.hint ? (
                              <span className="block truncate text-xs text-slate-500">{item.hint}</span>
                            ) : null}
                          </span>
                          {active ? <CornerDownLeftIcon className="size-3.5 shrink-0 text-sky-300" /> : null}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center gap-4 border-t border-white/10 px-4 py-2.5 text-[11px] text-slate-500">
              <span>
                <kbd className="font-sans font-semibold">↑↓</kbd> navigate
              </span>
              <span>
                <kbd className="font-sans font-semibold">↵</kbd> open
              </span>
              <span>
                <kbd className="font-sans font-semibold">esc</kbd> close
              </span>
              <span className="ml-auto text-slate-600">Oriental Admin</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
