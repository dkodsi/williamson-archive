let works = [];
let category = "all";
let restoringState = false;

const ALL_TYPES = ["Book", "Paper", "Public writing", "Review / interview"];
const PUBLIC_PROFILE = document.documentElement?.dataset?.publicationProfile === "public";
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value || "").replace(
  /[&<>"']/g,
  character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]
);
const normalized = value => String(value || "").normalize("NFKC")
  .toLocaleLowerCase().replace(/\s+/g, " ").trim();

async function init() {
  const response = await fetch("data/works.json");
  if (!response.ok) throw new Error("Catalogue unavailable");
  works = await response.json();
  const categories = [...new Set(works.map(work => work.category))];
  const editionCount = works.filter(work => work.edition_path).length;
  $("#stats").innerHTML = [
    `<span><strong>${works.length}</strong> works</span>`,

    `<span><strong>${editionCount}</strong> editions</span>`
  ].join("");
  $("#categoryFilters").innerHTML = categories.map(item =>
    `<button class="filter" data-category="${esc(item)}">${esc(item)} <span></span></button>`
  ).join("");
  bind();
  applyURLState();
  render({ updateURL: false });
}

function bind() {
  $$(".filter[data-category]").forEach(button => {
    button.onclick = () => {
      category = button.dataset.category;
      updateCategoryControls();
      render();
    };
  });
  $("#search").addEventListener("input", () => {
    render();
  });
  $("#sort").onchange = () => render();
  $$(".type-filter, .availability-filter").forEach(item => { item.onchange = () => render(); });
  $("#clearFilters").onclick = clearFilters;
  window.addEventListener("popstate", () => {
    restoringState = true;
    applyURLState();
    render({ updateURL: false });
    restoringState = false;
  });
  document.addEventListener("keydown", event => {
    if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      $("#search").focus();
    }
  });
  if (window.innerWidth <= 800 && category === "all") $(".category-panel").open = false;
}

function selectedAvailability() {
  return $(".availability-filter:checked")?.value || "all";
}

function selectedTypes() {
  return new Set($$(".type-filter:checked").map(item => item.value));
}

function titleMatches(work, query) {
  return !query || normalized(work.title).includes(normalized(query));
}

function current() {
  const query = $("#search").value.trim();
  const availability = selectedAvailability();
  const types = selectedTypes();
  const filtered = works.filter(work =>
    (availability === "all" || (work.edition_path ? "available" : "unavailable") === availability) &&
    (category === "all" || work.category === category) &&
    types.has(work.catalogue_type) &&
    titleMatches(work, query)
  );
  const sort = $("#sort").value;
  filtered.sort(
    sort === "az"
      ? (left, right) => left.title.localeCompare(right.title)
      : sort === "oldest"
        ? (left, right) => compareYears(left, right, 1)
        : sort === "citations"
          ? compareCitations
          : (left, right) => compareYears(left, right, -1)
  );
  return filtered;
}

function compareYears(left, right, direction) {
  if (left.year == null && right.year != null) return -1;
  if (right.year == null && left.year != null) return 1;
  return direction * ((left.year || 0) - (right.year || 0)) || left.title.localeCompare(right.title);
}

function compareCitations(left, right) {
  const leftCount = Number.isFinite(left.google_scholar_citations) ? left.google_scholar_citations : -1;
  const rightCount = Number.isFinite(right.google_scholar_citations) ? right.google_scholar_citations : -1;
  return rightCount - leftCount || compareYears(left, right, -1);
}

function updateCounts(filtered) {
  const availability = selectedAvailability();
  const types = selectedTypes();
  $("#categoryFilters").querySelectorAll(".filter").forEach(button => {
    button.querySelector("span").textContent = works.filter(work =>
      (availability === "all" || (work.edition_path ? "available" : "unavailable") === availability) &&
      types.has(work.catalogue_type) && work.category === button.dataset.category
    ).length;
  });
  $("#resultCount").textContent = filtered.length;
  $("#searchStatus").textContent = `${filtered.length} work${filtered.length === 1 ? "" : "s"} shown.`;
}

function updateCategoryControls() {
  $$(".filter[data-category]").forEach(item => {
    const active = item.dataset.category === category;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
}

function render({ updateURL = true } = {}) {
  const filtered = current();
  updateCounts(filtered);
  $("#empty").hidden = Boolean(filtered.length);
  const sort = $("#sort").value;
  if (["az", "citations"].includes(sort)) {
    $("#yearBuckets").innerHTML =
      `<section class="year-group ungrouped"><div>${filtered.map(card).join("")}</div></section>`;
  } else {
    const groups = new Map();
    filtered.forEach(work => {
      const year = work.year ?? "n.d.";
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year).push(work);
    });
    $("#yearBuckets").innerHTML = [...groups].map(([year, entries]) =>
      `<section class="year-group"><div class="year-label">${year}</div><div>${entries.map(card).join("")}</div></section>`
    ).join("");
  }
  $("#clearFilters").hidden = isDefaultState();
  if (updateURL && !restoringState) writeURLState();
}

function card(work) {
  const titleClass = work.kind === "Book" ? "work-title book-title" : "work-title";
  const actions = [];
  const title = `<a class="work-title-link" href="${esc(encodeURI(work.work_path))}">${esc(work.title)}</a>`;
  if (work.edition_path) actions.push(`<a class="work-link primary" href="${esc(encodeURI(work.edition_path))}">${PUBLIC_PROFILE ? "Read edition" : "HTML"}</a>`);
  if (work.edition_pdf_path) actions.push(`<a class="work-link" href="${esc(encodeURI(work.edition_pdf_path))}" target="_blank" rel="noopener">${PUBLIC_PROFILE ? "Download PDF" : "PDF"}</a>`);

  const cited = Number.isFinite(work.google_scholar_citations)
    ? `<span class="citation-count">Cited ${work.google_scholar_citations.toLocaleString()}</span>` : "";
  return `<article class="work-card">
    <div class="${titleClass}">${title}</div>
    ${work.reference_html ? `<div class="reference">${work.reference_html}</div>` : work.reference ? `<div class="reference">${esc(work.reference)}</div>` : ""}
    ${(actions.length || cited) ? `<div class="work-actions">${actions.join("")}${cited}</div>` : ""}
  </article>`;
}

function isDefaultState() {
  return !$("#search").value.trim() && category === "all" && selectedAvailability() === "all" &&
    selectedTypes().size === ALL_TYPES.length && $("#sort").value === "citations";
}

function clearFilters() {
  $("#search").value = "";
  category = "all";
  updateCategoryControls();
  $(".availability-filter[value=all]").checked = true;
  $$(".type-filter").forEach(item => { item.checked = true; });
  $("#sort").value = "citations";
  render();
}

function writeURLState() {
  const params = new URLSearchParams();
  const query = $("#search").value.trim();
  const availability = selectedAvailability();
  const types = [...selectedTypes()];
  const sort = $("#sort").value;
  if (query) params.set("q", query);
  if (availability !== "all") params.set("availability", availability);
  if (types.length !== ALL_TYPES.length) params.set("types", types.join(","));
  if (category !== "all") params.set("category", category);
  if (sort !== "citations") params.set("sort", sort);
  const queryString = params.toString();
  const next = `${location.pathname}${queryString ? `?${queryString}` : ""}${location.hash}`;
  history.replaceState(null, "", next);
}

function applyURLState() {
  const params = new URLSearchParams(location.search);
  $("#search").value = params.get("q") || "";
  const availability = params.get("availability");
  const availabilityInput = $(`.availability-filter[value="${CSS.escape(availability || "all")}"]`);
  (availabilityInput || $(".availability-filter[value=all]")).checked = true;
  const types = params.has("types") ? new Set(params.get("types").split(",")) : new Set(ALL_TYPES);
  $$(".type-filter").forEach(item => { item.checked = types.has(item.value); });
  const requestedCategory = params.get("category");
  category = $(`.filter[data-category="${CSS.escape(requestedCategory || "all")}"]`) ? (requestedCategory || "all") : "all";
  updateCategoryControls();
  const sort = params.get("sort");
  $("#sort").value = ["newest", "oldest", "az", "citations"].includes(sort) ? sort : "citations";
}

init().catch(() => {
  const status = $("#searchStatus");
  status.className = "catalogue-status";
  status.textContent = "Search and filters are temporarily unavailable. You can still browse the catalogue below.";
});
