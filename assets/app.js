let works = [];
let fulltextCache = { query: null, results: [] };
let resultPage;
let requestId = 0;
let queryTimer;
let editingQuery = false;
let indexPromise;
let worker;
let workerSerial = 0;
const workerRequests = new Map();

const ALL_TYPES = ["Book", "Paper", "Public writing", "Review / interview"];
const ARCHIVE_ROOT = document.body?.dataset?.discoveryRoot || "";
const DEFAULT_SCOPE = document.body?.dataset?.discoveryDefaultScope === "text" ? "text" : "titles";
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? "").replace(
  /[&<>"']/g,
  character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]
);
const normalized = value => String(value || "").normalize("NFKC")
  .toLocaleLowerCase().replace(/\s+/g, " ").trim();
const archiveHref = path => `${ARCHIVE_ROOT}${encodeURI(path)}`;
const selectedScope = () => $('input[name="scope"]:checked')?.value || DEFAULT_SCOPE;
const defaultSort = scope => scope === "text" ? "relevance" : "citations";
const compareYears = (left, right, direction) => {
  if (left.year == null && right.year != null) return 1;
  if (right.year == null && left.year != null) return -1;
  return direction * ((left.year || 0) - (right.year || 0)) || left.title.localeCompare(right.title);
};
const compareCitations = (left, right) => {
  const a = Number.isFinite(left.google_scholar_citations) ? left.google_scholar_citations : -1;
  const b = Number.isFinite(right.google_scholar_citations) ? right.google_scholar_citations : -1;
  return b - a || compareYears(left, right, -1);
};

function readState(params, defaultScope = DEFAULT_SCOPE) {
  const scope = ["titles", "text"].includes(params.get("scope")) ? params.get("scope") : defaultScope;
  return {
    query: params.get("q") || "", scope,
    availability: ["available", "unavailable"].includes(params.get("availability")) ? params.get("availability") : "all",
    types: params.has("types") ? ALL_TYPES.filter(type => params.get("types").split(",").includes(type)) : [...ALL_TYPES],
    sort: ["newest", "oldest", "az", "citations", "relevance"].includes(params.get("sort")) ? params.get("sort") : defaultSort(scope),
  };
}

function stateParameters(state, existing = "") {
  const params = new URLSearchParams(existing);
  for (const key of ["q", "scope", "category", "availability", "types", "sort"]) params.delete(key);
  if (state.query.trim()) params.set("q", state.query.trim());
  params.set("scope", state.scope);
  if (state.availability !== "all") params.set("availability", state.availability);
  if (state.types.length !== ALL_TYPES.length) params.set("types", state.types.join(","));
  if (state.sort !== defaultSort(state.scope)) params.set("sort", state.sort);
  return params;
}

function matchesFilters(work, state) {
  return (state.availability === "all" || (work.edition_path ? "available" : "unavailable") === state.availability) &&
    state.types.includes(work.catalogue_type);
}

function workOrder(sort) {
  return sort === "az" ? (a, b) => a.title.localeCompare(b.title)
    : sort === "oldest" ? (a, b) => compareYears(a, b, 1)
    : sort === "newest" ? (a, b) => compareYears(a, b, -1) : compareCitations;
}

function sortWorks(items, sort) {
  return items.sort(workOrder(sort));
}

function groupFilteredResults(results, catalogue, state) {
  const bySlug = new Map(catalogue.filter(work => work.edition_slug).map(work => [work.edition_slug, work]));
  const grouped = globalThis.TWArticleSearch.groupResults(results)
    .filter(group => bySlug.has(group.slug) && matchesFilters(bySlug.get(group.slug), state))
    .map(group => ({ ...group, work: bySlug.get(group.slug) }));
  if (state.sort !== "relevance") {
    const compare = workOrder(state.sort);
    grouped.sort((a, b) => compare(a.work, b.work));
  }
  return grouped;
}

const Discovery = { readState, stateParameters, matchesFilters, sortWorks, groupFilteredResults };
globalThis.TWDiscovery = Discovery;

async function init() {
  configureMobileFilters();
  const response = await fetch(`${ARCHIVE_ROOT}data/works.json`);
  if (!response.ok) throw new Error("Catalogue unavailable");
  works = await response.json();
  const editionCount = works.filter(work => work.edition_path).length;
  $("#stats").innerHTML = [
    `<span><strong>${works.length}</strong> works</span>`,

    `<span><strong>${editionCount}</strong> editions</span>`
  ].join("");
  bind();
  applyURLState();
  render({ updateURL: false });
}

function configureMobileFilters() {
  const panel = $("#catalogueFilters");
  if (!panel || typeof window === "undefined") return;
  const media = window.matchMedia?.("(max-width: 800px)");
  const applyLayout = mobile => {
    // A resize must not hide a control that still has keyboard focus.
    if (!mobile || !panel.contains?.(document.activeElement)) panel.open = !mobile;
    panel.tabIndex = mobile ? -1 : 0;
  };
  if (media) {
    applyLayout(media.matches);
    media.addEventListener?.("change", event => applyLayout(event.matches));
  } else applyLayout(window.innerWidth <= 800);
}

function bind() {
  $("#discoverySearch").addEventListener("submit", event => {
    event.preventDefault(); finishQueryEdit(); render();
  });
  $("#search").addEventListener("input", () => {
    clearTimeout(queryTimer);
    // Cancel pending results immediately, even before the debounced request begins.
    requestId++;
    queryTimer = setTimeout(() => {
      render({ historyMode: editingQuery ? "replace" : "push" });
      editingQuery = true;
    }, selectedScope() === "text" ? 320 : 120);
  });
  $("#search").addEventListener("blur", () => { editingQuery = false; });
  $$("input[name=scope]").forEach(input => {
    input.addEventListener("change", () => {
      finishQueryEdit();
      const sort = $("#sort");
      if (["citations", "relevance"].includes(sort.value)) sort.value = defaultSort(input.value);
      render();
    });
  });
  $("#sort").onchange = () => render();
  $$(".type-filter, .availability-filter").forEach(item => { item.onchange = () => render(); });
  $("#clearFilters").onclick = clearFilters;
  $("#moreWorks").onclick = () => renderMoreGroups({ focusNew: true });
  window.addEventListener("popstate", () => {
    finishQueryEdit();
    applyURLState(); render({ updateURL: false });
  });
  document.addEventListener("keydown", event => {
    if (event.key === "/" && !event.defaultPrevented && !event.isComposing &&
        !event.ctrlKey && !event.metaKey && !event.altKey &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) && !document.activeElement.isContentEditable) {
      event.preventDefault(); $("#search").focus();
    }
  });
}

function finishQueryEdit() {
  clearTimeout(queryTimer);
  editingQuery = false;
}
function stateFromControls() {
  return { query: $("#search").value.trim(), scope: selectedScope(),
    availability: $(".availability-filter:checked")?.value || "all",
    types: $$(".type-filter:checked").map(item => item.value), sort: $("#sort").value };
}
function titleMatches(work, query) { return !query || normalized(work.title).includes(normalized(query)); }
function updateCounts(filtered, status = `${filtered.length} work${filtered.length === 1 ? "" : "s"}`) {
  $("#resultCountLabel").hidden = false;
  $("#resultCount").textContent = filtered.length;
  $("#searchStatus").textContent = status;
}
function showSearchMessage(status, message = status) {
  $("#searchStatus").textContent = status;
  $("#empty").textContent = message;
  $("#empty").hidden = false;
}
function updateFilterSummary(state) {
  const filters = [];
  if (state.availability !== "all") filters.push({ label: state.availability === "available" ? "With editions" : "Without editions", clear() { $(".availability-filter[value=all]").checked = true; } });
  if (state.types.length !== ALL_TYPES.length) filters.push({ label: state.types.length ? state.types.join(", ") : "No types selected", clear() { $$(".type-filter").forEach(input => { input.checked = true; }); } });
  $("#filterCount").textContent = filters.length ? ` · ${filters.length} active` : "";
  $("#clearFilters").hidden = !filters.length;
  const region = $("#activeFilters");
  region.hidden = !filters.length;
  region.replaceChildren();
  for (const filter of filters) {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = `${filter.label} ×`;
    button.setAttribute("aria-label", `Remove filter: ${filter.label}`);
    button.onclick = () => { filter.clear(); render(); $("#catalogueResults").focus({ preventScroll: true }); };
    region.append(button);
  }
}

function loadIndex() {
  return indexPromise ||= fetch(`${ARCHIVE_ROOT}assets/article-search-index.json`).then(response => {
    if (!response.ok) throw new Error("Search unavailable");
    return response.json();
  }).catch(error => { indexPromise = undefined; throw error; });
}
function searchFulltext(query) {
  if (typeof Worker !== "undefined" && worker !== null) {
    try {
      if (!worker) {
        worker = new Worker(`${ARCHIVE_ROOT}assets/catalogue-search-worker.js?v=20261112`);
        worker.onmessage = ({ data }) => {
          const pending = workerRequests.get(data.requestId);
          if (!pending) return;
          workerRequests.delete(data.requestId);
          data.state === "error" ? pending.reject(new Error("Search unavailable")) : pending.resolve(data);
        };
        worker.onerror = () => {
          worker.terminate(); worker = null;
          for (const pending of workerRequests.values()) pending.reject(new Error("Search unavailable"));
          workerRequests.clear();
        };
      }
      return new Promise((resolve, reject) => {
        const id = ++workerSerial; workerRequests.set(id, { resolve, reject });
        try { worker.postMessage({ requestId: id, query, kind: "passages" }); }
        catch (error) { workerRequests.delete(id); reject(error); }
      }).catch(() => loadIndex().then(index => globalThis.TWArticleSearch.search(index, query)));
    } catch (_) { worker = null; }
  }
  return loadIndex().then(index => globalThis.TWArticleSearch.search(index, query));
}

function render({ updateURL = true, historyMode = "push" } = {}) {
  const request = ++requestId;
  const state = stateFromControls();
  const fulltext = state.scope === "text";
  updateFilterSummary(state);
  $("#searchStatus").className = fulltext ? "discovery-status" : "visually-hidden";
  $("#search").placeholder = fulltext ? "Search full text…" : "Search titles…";
  $("#searchHint").textContent = fulltext ? 'Use "quotes" for phrases; * matches part of a word.' : "";
  $("#searchHint").hidden = !fulltext;
  $("#sort option[value=relevance]").hidden = !fulltext;
  if (updateURL) writeURLState(state, historyMode);
  $$('[data-titles-link]').forEach(link => {
    const params = stateParameters({ ...state, scope: "titles", sort: state.sort === "relevance" ? "citations" : state.sort });
    link.href = `${ARCHIVE_ROOT}index.html?${params}`;
  });
  $("#yearBuckets").hidden = fulltext;
  $("#fulltextGroups").hidden = true; $("#moreWorks").hidden = true;
  $("#empty").hidden = true;
  return fulltext ? renderFulltext(state, request) : renderTitles(state);
}

function renderTitles(state) {
  const filtered = sortWorks(works.filter(work => matchesFilters(work, state) && titleMatches(work, state.query)), state.sort);
  updateCounts(filtered);
  $("#empty").textContent = "No works match your search and filters.";
  $("#empty").hidden = Boolean(filtered.length);
  if (["az", "citations", "relevance"].includes(state.sort)) {
    $("#yearBuckets").innerHTML = `<section class="year-group ungrouped"><div>${filtered.map(card).join("")}</div></section>`;
  } else {
    const groups = new Map();
    filtered.forEach(work => { const year = work.year ?? "n.d."; if (!groups.has(year)) groups.set(year, []); groups.get(year).push(work); });
    $("#yearBuckets").innerHTML = [...groups].map(([year, entries]) => `<section class="year-group"><div class="year-label">${year}</div><div>${entries.map(card).join("")}</div></section>`).join("");
  }
}

async function renderFulltext(state, request) {
  $("#resultCountLabel").hidden = true;
  const parsed = globalThis.TWArticleSearch.parseQuery(state.query);
  if (parsed.state !== "ready") {
    showSearchMessage(parsed.state === "empty" ? "Enter a word or phrase to search the editions." : "Enter searchable words and close any quotation marks.");
    return;
  }
  showSearchMessage("Searching editions…");
  try {
    if (fulltextCache.query !== state.query) {
      const response = await searchFulltext(state.query);
      if (request !== requestId) return;
      fulltextCache = { query: state.query, results: response.results || [] };
    }
    if (request !== requestId) return;
    const groups = groupFilteredResults(fulltextCache.results, works, state);
    resultPage = { state, groups, shown: 0 };
    $("#fulltextGroups").replaceChildren();
    const passages = groups.reduce((n, group) => n + group.passages.length, 0);
    updateCounts(groups, `${groups.length.toLocaleString()} work${groups.length === 1 ? "" : "s"} · ${passages.toLocaleString()} matching passage${passages === 1 ? "" : "s"}.`);
    $("#empty").hidden = true;
    if (!groups.length) {
      $("#empty").textContent = state.availability === "unavailable" ? "Works without digital editions cannot be searched in full text. Choose All or Editions to see matching passages." : "No matching passages with these filters. Try fewer words or clear a filter.";
      $("#empty").hidden = false; return;
    }
    $("#fulltextGroups").hidden = false;
    renderMoreGroups();
  } catch (_) {
    if (request !== requestId) return;
    showSearchMessage("Full-text search is temporarily unavailable. You can still search titles.",
      "Full-text search is temporarily unavailable. Try Search again, or choose Titles above.");
  }
}

function renderMoreGroups({ focusNew = false } = {}) {
  if (!resultPage) return;
  const { state, groups, shown } = resultPage;
  // Use the completed query, never text typed while an older result set is visible.
  const query = state.query;
  const returnTo = `${location.pathname}?${stateParameters(state)}`;
  const passageHTML = result => {
    const href = globalThis.TWArticleSearch.resultHref(result, query, { editionRoot: `${ARCHIVE_ROOT}editions/`, returnTo });
    return `<li><a href="${esc(href)}"><span class="passage-section">${esc(result.section || "Passage")}</span><span class="fulltext-result-snippet">${globalThis.TWArticleSearch.snippet(result)}</span></a></li>`;
  };
  let firstNew;
  for (const group of groups.slice(shown, shown + 12)) {
    const item = document.createElement("article"); item.className = "discovery-work";
    item.innerHTML = `<header><h2><a href="${esc(archiveHref(group.work.work_path))}">${esc(group.work.title)}</a></h2><p>${esc(group.work.year ?? "n.d.")} · ${group.passages.length} matching passage${group.passages.length === 1 ? "" : "s"}</p></header><ol class="passage-list">${group.passages.slice(0, 3).map(passageHTML).join("")}</ol>`;
    if (group.passages.length > 3) {
      const details = document.createElement("details"); details.className = "more-passages";
      const summary = document.createElement("summary"); summary.textContent = `Show ${group.passages.length - 3} more matching passages`;
      details.append(summary);
      details.addEventListener("toggle", () => {
        if (!details.open || details.dataset.loaded) return;
        details.dataset.loaded = "true";
        const list = document.createElement("ol"); list.className = "passage-list";
        list.innerHTML = group.passages.slice(3).map(passageHTML).join(""); details.append(list);
      });
      item.append(details);
    }
    $("#fulltextGroups").append(item);
    firstNew ||= item;
  }
  resultPage.shown = Math.min(shown + 12, groups.length);
  $("#moreWorks").hidden = resultPage.shown >= groups.length;
  $("#moreWorks").textContent = `Show more works (${groups.length - resultPage.shown} remaining)`;
  if (focusNew) firstNew?.querySelector("h2 a")?.focus();
}

function card(work) {
  const titleClass = work.kind === "Book" ? "work-title book-title" : "work-title";
  const actions = [];
  const title = `<a class="work-title-link" href="${esc(archiveHref(work.work_path))}">${esc(work.title)}</a>`;
  if (work.edition_path) actions.push(`<a class="work-link primary" href="${esc(archiveHref(work.edition_path))}">Read edition</a>`);
  if (work.edition_pdf_path) actions.push(`<a class="work-link" href="${esc(archiveHref(work.edition_pdf_path))}" target="_blank" rel="noopener">Download PDF</a>`);

  const cited = Number.isFinite(work.google_scholar_citations) ? `<span class="citation-count">Cited ${work.google_scholar_citations.toLocaleString()}</span>` : "";
  return `<article class="work-card"><div class="${titleClass}">${title}</div>${work.reference_html ? `<div class="reference">${work.reference_html}</div>` : work.reference ? `<div class="reference">${esc(work.reference)}</div>` : ""}${(actions.length || cited) ? `<div class="work-actions">${actions.join("")}${cited}</div>` : ""}</article>`;
}
function clearFilters() {
  $(".availability-filter[value=all]").checked = true;
  $$(".type-filter").forEach(item => { item.checked = true; });
  render();
  $("#catalogueResults").focus({ preventScroll: true });
}
function writeURLState(state, mode = "push") {
  const params = stateParameters(state, location.search);
  const next = `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`;
  if (next !== `${location.pathname}${location.search}${location.hash}`) history[mode === "replace" ? "replaceState" : "pushState"](null, "", next);
}
function applyURLState() {
  const params = new URLSearchParams(location.search);
  // Unsupported topic filters must not silently restrict catalogue results.
  if (params.has("category")) {
    params.delete("category");
    history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
  }
  const state = readState(params);
  $("#search").value = state.query;
  $$(".availability-filter").forEach(input => { input.checked = input.value === state.availability; });
  $$(".type-filter").forEach(input => { input.checked = state.types.includes(input.value); });
  $$("input[name=scope]").forEach(input => { input.checked = input.value === state.scope; });
  $("#sort").value = state.sort;
}

init().catch(() => {
  const status = $("#searchStatus");
  status.className = "catalogue-status";
  status.textContent = DEFAULT_SCOPE === "text"
    ? "Search and filters are temporarily unavailable. Use the Catalogue link to browse works."
    : "Search and filters are temporarily unavailable. You can still browse the catalogue below.";
});
