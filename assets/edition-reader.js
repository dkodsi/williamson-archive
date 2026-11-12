(function () {
  "use strict";

  const STORAGE_KEY = "tw-reader-preferences-v1";
  const root = document.documentElement;
  const body = document.body;
  const clamp = (value, minimum, maximum) =>
    Math.min(maximum, Math.max(minimum, value));
  let preferences = {};

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      if (Number.isFinite(stored.size)) preferences.size = clamp(stored.size, 15, 23);
      if ([39.5, 49].includes(stored.width)) preferences.width = stored.width;
      if (typeof stored.night === "boolean") preferences.night = stored.night;
    }
  } catch (_error) {
    preferences = {};
  }

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

  function searchReturnURL(currentHref, archiveHref) {
    try {
      if (!archiveHref) return null;
      const current = new URL(currentHref);
      const archive = new URL(archiveHref, current);
      const base = new URL("./", archive);
      const parameters = current.searchParams;
      const requested = parameters.get("return");
      const permitted = new Set([
        base.pathname, new URL("index.html", base).pathname,
        new URL("search/", base).pathname, new URL("search/index.html", base).pathname,
      ]);
      if (requested) {
        const destination = new URL(requested, current);
        if (destination.origin === current.origin && !destination.username && !destination.password &&
            permitted.has(destination.pathname)) {
          return destination.pathname + destination.search + destination.hash;
        }
      }
      const query = parameters.get("search");
      if (!query) return null;
      const destination = new URL("search/index.html", base);
      destination.searchParams.set("q", query);
      return destination.pathname + destination.search;
    } catch (_error) {
      return null;
    }
  }

  function pageTargets(article) {
    const printed = [...article.querySelectorAll(".print-page[id][data-page]")];
    const markers = printed.length ? printed : [...article.querySelectorAll(".orig-page[id][data-page]")];
    return markers.map(marker => ({ label: marker.dataset.page, id: marker.id }));
  }

  function notePreviewContent(note) {
    const copy = note.cloneNode(true);
    copy.querySelectorAll(".note-back, .orig-page, .print-page, script, style, iframe, object, embed").forEach(node => node.remove());
    for (const node of [copy, ...copy.querySelectorAll("*")]) {
      for (const attribute of [...node.attributes]) {
        if (attribute.name === "id" || /^on/i.test(attribute.name) ||
            ["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "for", "headers", "autofocus", "tabindex"].includes(attribute.name)) {
          node.removeAttribute(attribute.name);
        }
        if (["href", "xlink:href"].includes(attribute.name) && /^\s*(?:javascript|data):/i.test(attribute.value)) {
          node.removeAttribute(attribute.name);
        }
      }
    }
    copy.classList.remove("note-entry");
    copy.classList.add("reader-note-content");
    return copy;
  }

  // Expose the small, deterministic helpers for the DOM regression fixtures.
  globalThis.TWEditionReader = { searchReturnURL, pageTargets, notePreviewContent };

  function installNavigation() {
    const article = document.querySelector("article");
    const panel = document.querySelector("#tw-reader-navigation");
    const toggle = button("[data-reader-navigation-toggle]");
    if (!article || !panel || !toggle) return;
    const create = (tag, text, className) => {
      const node = document.createElement(tag);
      if (text != null) node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    const headings = [...article.querySelectorAll("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]")]
      .filter(heading => !heading.closest("header"));
    const pages = pageTargets(article);
    const heading = create("h2", "Navigate this edition");
    const close = create("button", "Close", "reader-panel-close");
    close.type = "button";
    close.setAttribute("aria-label", "Close navigation");
    const header = create("div", null, "reader-panel-heading");
    header.append(heading, close);
    panel.append(header);
    const closePanel = (restoreFocus = false) => {
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      if (restoreFocus) toggle.focus({ preventScroll: true });
    };
    let firstControl;
    if (pages.length) {
      const form = create("form", null, "reader-page-jump");
      const label = create("label", "Jump to page");
      const input = create("input");
      input.type = "text";
      input.id = "tw-reader-page";
      input.autocomplete = "off";
      input.setAttribute("list", "tw-reader-pages");
      input.setAttribute("aria-describedby", "tw-reader-page-status");
      input.placeholder = pages.length === 1 ? pages[0].label : `${pages[0].label} … ${pages.at(-1).label}`;
      label.htmlFor = input.id;
      const choices = create("datalist");
      choices.id = "tw-reader-pages";
      for (const page of pages) {
        const option = create("option");
        option.value = page.label;
        choices.append(option);
      }
      const submit = create("button", "Go");
      submit.type = "submit";
      const row = create("div");
      row.append(input, submit);
      const status = create("p", "", "reader-page-status");
      status.id = "tw-reader-page-status";
      status.setAttribute("role", "status");
      form.append(label, row, choices, status);
      form.addEventListener("submit", event => {
        event.preventDefault();
        const value = input.value.trim().toLocaleLowerCase().replace(/^(?:page\s+|p\.\s*)/, "");
        const target = pages.find(page => page.label.toLocaleLowerCase() === value);
        if (!target) {
          status.textContent = "Choose a page from the list.";
          input.setAttribute("aria-invalid", "true");
          return;
        }
        status.textContent = "";
        input.removeAttribute("aria-invalid");
        closePanel(true);
        location.hash = `#${encodeURIComponent(target.id)}`;
        document.getElementById(target.id)?.scrollIntoView({ block: "start" });
      });
      firstControl = input;
      panel.append(form);
    }
    if (headings.length) {
      const contents = create("nav");
      contents.setAttribute("aria-label", "Contents");
      contents.append(create("h3", "Contents"));
      const list = create("ol", null, "reader-contents");
      const minimumLevel = Math.min(...headings.map(item => Number(item.tagName.slice(1))));
      for (const item of headings) {
        const clean = item.cloneNode(true);
        clean.querySelectorAll(".note-ref, annotation, annotation-xml").forEach(node => node.remove());
        const text = clean.textContent.replace(/\s+/g, " ").trim();
        if (!text) continue;
        const link = create("a", text);
        link.href = `#${encodeURIComponent(item.id)}`;
        link.addEventListener("click", () => closePanel(true));
        const row = create("li");
        row.style.setProperty("--heading-depth", String(Math.min(3, Number(item.tagName.slice(1)) - minimumLevel)));
        row.append(link);
        list.append(row);
        firstControl ||= link;
      }
      contents.append(list);
      panel.append(contents);
    }
    if (pages.length || headings.length) {
      toggle.hidden = false;
      toggle.addEventListener("click", () => {
        if (!panel.hidden) { closePanel(true); return; }
        panel.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        (firstControl || close).focus({ preventScroll: true });
      });
      close.addEventListener("click", () => closePanel(true));
      document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !panel.hidden) {
          event.preventDefault();
          closePanel(true);
        }
      });
      document.addEventListener("pointerdown", event => {
        if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) closePanel(false);
      });
    }
    const returnLink = button("[data-reader-search-return]");
    const archiveLink = document.querySelector(".reader-home");
    const returnURL = searchReturnURL(location.href, archiveLink?.getAttribute("href"));
    if (returnLink && returnURL) {
      returnLink.href = returnURL;
      returnLink.hidden = false;
    }
    const bar = document.querySelector(".reader-bar");
    const measureBar = () => {
      if (!bar) return;
      const height = bar.getBoundingClientRect().height;
      root.style.setProperty("--reader-toolbar-height", `${height}px`);
      root.style.setProperty("--reader-anchor-offset", `${height + 20}px`);
    };
    measureBar();
    if (globalThis.ResizeObserver && bar) new ResizeObserver(measureBar).observe(bar);
    else globalThis.addEventListener?.("resize", measureBar);
    installNotePreviews(article, create);
  }

  function installNotePreviews(article, create) {
    const dialog = create("dialog", null, "reader-note-preview");
    if (typeof dialog.showModal !== "function") return;
    dialog.setAttribute("aria-labelledby", "tw-reader-note-title");
    const title = create("h2");
    title.id = "tw-reader-note-title";
    const close = create("button", "Close", "reader-panel-close");
    close.type = "button";
    close.setAttribute("aria-label", "Close note preview");
    const header = create("div", null, "reader-panel-heading");
    header.append(title, close);
    const content = create("div");
    const goTo = create("a", "Go to note", "reader-note-location");
    dialog.append(header, content, goTo);
    body.append(dialog);
    let opener;
    let restoreFocus = true;
    dialog.addEventListener("close", () => {
      if (restoreFocus) opener?.focus({ preventScroll: true });
      content.replaceChildren();
      opener = null;
    });
    dialog.addEventListener("cancel", () => { restoreFocus = true; });
    close.addEventListener("click", () => { restoreFocus = true; dialog.close(); });
    dialog.addEventListener("click", event => {
      if (event.target === dialog) { restoreFocus = true; dialog.close(); }
      else if (event.target.closest("a")) {
        restoreFocus = false;
        dialog.close();
      }
    });
    article.addEventListener("click", event => {
      if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const reference = event.target.closest("a.note-ref");
      if (!reference || !article.contains(reference)) return;
      const href = reference.getAttribute("href");
      if (!href?.startsWith("#")) return;
      let id;
      try { id = decodeURIComponent(href.slice(1)); } catch (_error) { return; }
      const note = document.getElementById(id);
      if (!note?.classList.contains("note-entry") || !article.contains(note)) return;
      content.replaceChildren(notePreviewContent(note));
      title.textContent = `Note ${note.dataset.noteLabel || reference.textContent.trim() || note.dataset.note}`;
      goTo.href = href;
      opener = reference;
      restoreFocus = true;
      try { dialog.showModal(); } catch (_error) { return; }
      event.preventDefault();
      close.focus({ preventScroll: true });
    });
  }

  installNavigation();

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
