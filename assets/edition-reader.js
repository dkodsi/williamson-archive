(function () {
  "use strict";

  const STORAGE_KEY = "tw-reader-preferences-v1";
  const root = document.documentElement;
  const body = document.body;
  let preferences = {};

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (stored && typeof stored === "object" && !Array.isArray(stored)) preferences = stored;
  } catch (_error) {
    preferences = {};
  }

  const clamp = (value, minimum, maximum) =>
    Math.min(maximum, Math.max(minimum, value));
  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch (_error) {
      // Reading controls still work for this page when browser storage is unavailable.
    }
  };
  const button = selector => document.querySelector(selector);

  function apply() {
    if (preferences.size) {
      root.style.setProperty("--reader-size", `${preferences.size}px`);
    }
    if (preferences.width) {
      root.style.setProperty("--measure", `${preferences.width}rem`);
    }
    body.classList.toggle("reader-night", Boolean(preferences.night));
    button("[data-reader-width]")?.classList.toggle(
      "active", preferences.width === 49
    );
    button("[data-reader-width]")?.setAttribute(
      "aria-pressed", String(preferences.width === 49)
    );
    button("[data-reader-theme]")?.classList.toggle(
      "active", Boolean(preferences.night)
    );
    button("[data-reader-theme]")?.setAttribute(
      "aria-pressed", String(Boolean(preferences.night))
    );
  }

  button("[data-reader-size-down]")?.addEventListener("click", () => {
    preferences.size = clamp((preferences.size || 17) - 1, 15, 23);
    apply();
    save();
  });
  button("[data-reader-size-up]")?.addEventListener("click", () => {
    preferences.size = clamp((preferences.size || 17) + 1, 15, 23);
    apply();
    save();
  });
  button("[data-reader-width]")?.addEventListener("click", () => {
    preferences.width = (preferences.width || 39.5) >= 49 ? 39.5 : 49;
    apply();
    save();
  });
  button("[data-reader-theme]")?.addEventListener("click", () => {
    preferences.night = !preferences.night;
    apply();
    save();
  });

  apply();

  function highlightSearchMatch() {
    if (!location.hash.startsWith("#passage-") || !globalThis.TWArticleSearch) return;
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!target) return;
    const parameters = new URLSearchParams(location.search);
    const rawQuery = parameters.get("search") || "";
    if (!rawQuery) return;
    const parsed = globalThis.TWArticleSearch.parseQuery(rawQuery);
    const exact = parameters.get("exact") === "1";
    const needles = globalThis.TWArticleSearch.queryNeedles(parsed, exact);
    const mapped = globalThis.TWArticleSearch.normalizedTextMap(target);
    const recorded = (parameters.get("match") || "")
      .split(",")
      .map(value => value.match(/^(\d+):(\d+)$/))
      .filter(Boolean)
      .map(match => ({ start: Number(match[1]), end: Number(match[2]) }))
      .filter(match => match.start >= 0 && match.end > match.start && match.end <= mapped.text.length);
    const fallback = needles.map(needle => {
      const start = mapped.text.indexOf(needle);
      return start >= 0 ? { start, end: start + needle.length } : null;
    }).filter(Boolean);
    const candidates = (recorded.length ? recorded : fallback).map(({ start, end }) => {
      const first = mapped.map[start];
      const last = mapped.map[end - 1];
      return first && last ? { first, last, start, end } : null;
    }).filter(Boolean).sort((a, b) => a.start - b.start || b.end - a.end);
    const merged = [];
    for (const candidate of candidates) {
      const previous = merged.at(-1);
      if (previous && candidate.start < previous.end) {
        if (candidate.end > previous.end) {
          previous.end = candidate.end;
          previous.last = candidate.last;
        }
      } else {
        merged.push(candidate);
      }
    }
    const marks = [];
    for (const { first, last } of merged.reverse()) {
      const range = document.createRange();
      range.setStart(first.node, first.start);
      range.setEnd(last.node, last.end);
      const mark = document.createElement("mark");
      mark.className = "search-match";
      mark.append(range.extractContents());
      range.insertNode(mark);
      marks.push(mark);
    }
    if (!marks.length) {
      target.classList.add("search-passage-fallback");
      setTimeout(() => target.classList.remove("search-passage-fallback"), 12000);
      return;
    }
    setTimeout(() => {
      for (const mark of marks) mark.replaceWith(...mark.childNodes);
      target.normalize();
    }, 12000);
  }

  highlightSearchMatch();
}());
