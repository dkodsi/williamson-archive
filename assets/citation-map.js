let graph;
let lineages;
let nodes;
let labels;
let outgoing;
let incoming;
let currentId;
let connectedNodes;
let overviewPositions;
let overviewYears;
let maximumInfluence;
let currentView = "timeline";
let catalogueNodes = [];
let decadeFilter = "all";
let topicFilter = "all";
let searchQuery = "";
let selectedEdge = null;
const $ = selector => document.querySelector(selector);
const normalized = value => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[’‘]/g, "\'").trim();

const SVG = "http://www.w3.org/2000/svg";
const esc = value => String(value ?? "").replace(
  /[&<>"']/g,
  character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]
);

function label(node) {
  return `${node.title} — ${node.year ?? "n.d."}`;
}

function chronological(ids) {
  return [...ids].sort((left, right) =>
    (nodes.get(left).year ?? 9999) - (nodes.get(right).year ?? 9999) ||
    nodes.get(left).title.localeCompare(nodes.get(right).title)
  );
}

function neighbourList(ids, direction) {
  const items = ids.map(id => nodes.get(id)).filter(Boolean);
  const renderItems = values => `<ul>${values.map(node => {
    const source = direction === "outgoing" ? currentId : node.id;
    const target = direction === "outgoing" ? node.id : currentId;
    return `<li><div><button type="button" data-work="${esc(node.id)}">${esc(node.title)}</button>` +
      `<span>${esc(node.year ?? "n.d.")}</span></div>` +
      `<button class="citation-evidence-button" type="button" data-edge-source="${esc(source)}" data-edge-target="${esc(target)}">View citation</button></li>`;
  }).join("")}</ul>`;
  if (items.length <= 8) return renderItems(items);
  return renderItems(items.slice(0, 8)) +
    `<details><summary>${items.length - 8} more</summary>${renderItems(items.slice(8))}</details>`;
}

function element(name, attributes = {}) {
  const item = document.createElementNS(SVG, name);
  Object.entries(attributes).forEach(([key, value]) => item.setAttribute(key, value));
  return item;
}

function nodeColour(node) {
  return node.type === "Book" ? "#7f342d" : "#8f8a81";
}

function addDefinitions(svg) {
  const defs = element("defs");
  const marker = element("marker", {
    id: "citationArrow", viewBox: "0 0 10 10", refX: "8", refY: "5",
    markerWidth: "6", markerHeight: "6", orient: "auto-start-reverse"
  });
  marker.append(element("path", { d: "M 0 0 L 10 5 L 0 10 z" }));
  defs.append(marker);
  svg.append(defs);
}

function activateNode(id) {
  const restoreFocus = Boolean(document.activeElement?.closest?.("#citationGraph, #citationFocus, #timelineList, #citationMatches, #connectionsListItems"));
  currentView = "focus";
  selectedEdge = null;
  render(id);
  if (restoreFocus) document.querySelector(".citation-graph-node.selected")?.focus({ preventScroll: true });
}

function addNode(layer, node, x, y, radius, keyboard = true, selected = false) {
  const external = Number.isFinite(node.external_citations) ?
    ` External citations ${node.external_citations}.` : "";
  const item = element("g", {
    class: `citation-graph-node${selected ? " selected" : ""}`,
    transform: `translate(${x.toFixed(2)} ${y.toFixed(2)})`,
    role: "button",
    "aria-label": `${label(node)}. Cites ${node.out_degree}; cited by ${node.in_degree}.${external}`,
    tabindex: keyboard ? "0" : "-1"
  });
  if (selected) item.append(element("circle", {
    class: "citation-node-halo", r: (radius + 3.2).toFixed(2)
  }));
  const circle = element("circle", {
    class: "citation-node-circle",
    r: radius.toFixed(2), fill: nodeColour(node)
  });
  if (selected) item.setAttribute("aria-pressed", "true");
  const title = element("title");
  title.textContent = `${label(node)} — cites ${node.out_degree}; cited by ${node.in_degree}` +
    (Number.isFinite(node.external_citations) ? `; ${node.external_citations} external citations` : "");
  item.append(circle, title);
  item.addEventListener("click", () => activateNode(node.id));
  item.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateNode(node.id);
    }
  });
  layer.append(item);
}

function displayTitle(node, limit = 34) {
  return node.title.length <= limit ? node.title : `${node.title.slice(0, limit - 1).trim()}…`;
}

function addGraphLabel(layer, node, x, y, anchor = "start", selected = false) {
  const text = element("text", {
    class: `citation-graph-label${selected ? " selected" : ""}`,
    x, y, "text-anchor": anchor,
    role: "button", tabindex: "0",
    "aria-label": `Focus ${label(node)}`
  });
  text.textContent = displayTitle(node);
  const title = element("title");
  title.textContent = label(node);
  text.append(title);
  text.addEventListener("click", () => activateNode(node.id));
  text.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateNode(node.id);
    }
  });
  layer.append(text);
}

function boxesOverlap(left, right) {
  return !(
    left.x2 < right.x1 || left.x1 > right.x2 ||
    left.y2 < right.y1 || left.y1 > right.y2
  );
}

function placeGraphLabels(layer, labelNodes, positions, selectedId, bounds, limit, titleLimit) {
  const occupied = [];
  labelNodes
    .slice()
    .sort((left, right) =>
      Number(right.id === selectedId) - Number(left.id === selectedId) ||
      Number(right.type === "Book") - Number(left.type === "Book") ||
      (right.in_degree + right.out_degree) - (left.in_degree + left.out_degree) ||
      left.title.localeCompare(right.title)
    )
    .slice(0, limit)
    .forEach(node => {
      const point = positions.get(node.id);
      const title = displayTitle(node, node.id === selectedId ? 42 : titleLimit);
      const width = title.length * 5.4;
      const rightFits = point.x + 8 + width <= bounds.right - 8;
      const leftFits = point.x - 8 - width >= bounds.left + 8;
      const anchor = rightFits || !leftFits ? "start" : "end";
      const x = point.x + (anchor === "start" ? 8 : -8);
      const attempts = [-7, 8, -19, 20, -31, 32].map(offset => ({
        x, y: point.y + offset, anchor
      }));
      const placement = attempts.find(attempt => {
        const x1 = attempt.anchor === "start" ? attempt.x : attempt.x - width;
        const box = { x1, x2: x1 + width, y1: attempt.y - 10, y2: attempt.y + 2 };
        if (
          box.x1 < bounds.left + 4 || box.x2 > bounds.right - 4 ||
          box.y1 < bounds.top + 4 || box.y2 > bounds.bottom - 4 ||
          occupied.some(item => boxesOverlap(item, box))
        ) {
          return false;
        }
        occupied.push(box);
        return true;
      });
      if (placement) {
        if (Math.abs(placement.y - point.y) > 12) layer.append(element("line", {
          class: "citation-label-leader", x1: point.x, y1: point.y,
          x2: placement.x, y2: placement.y - 3
        }));
        addGraphLabel(
          layer, node, placement.x, placement.y, placement.anchor, node.id === currentId
        );
      }
    });
}

function addOverviewLabels(layer) {
  placeGraphLabels(
    layer, connectedNodes, overviewPositions, currentId,
    { left: 0, right: 1000, top: 0, bottom: 540 }, 24, 28
  );
}

function shortenedLine(start, end, startPadding, endPadding) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  return {
    x1: start.x + dx * startPadding / length,
    y1: start.y + dy * startPadding / length,
    x2: end.x - dx * endPadding / length,
    y2: end.y - dy * endPadding / length
  };
}

function branchingPath(start, end, startPadding = 0, endPadding = 0) {
  const line = shortenedLine(start, end, startPadding, endPadding);
  const middle = (line.x1 + line.x2) / 2;
  return `M ${line.x1.toFixed(2)} ${line.y1.toFixed(2)} C ${middle.toFixed(2)} ${line.y1.toFixed(2)}, ${middle.toFixed(2)} ${line.y2.toFixed(2)}, ${line.x2.toFixed(2)} ${line.y2.toFixed(2)}`;
}

function hash(value) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function nodeRadius(node, selected = false) {
  if (selected) return 10;
  return 2.8 + 5.8 * Math.sqrt(
    Math.log1p(node.in_degree) / Math.max(1, Math.log1p(maximumInfluence))
  );
}

function addYearAxis(layer, firstYear, lastDatedYear, lastAxisYear, yearX, hasUndated) {
  const tickYears = [firstYear];
  for (let year = Math.ceil(firstYear / 10) * 10; year <= lastDatedYear; year += 10) {
    if (!tickYears.includes(year)) tickYears.push(year);
  }
  if (!tickYears.includes(lastDatedYear)) tickYears.push(lastDatedYear);
  tickYears.forEach(year => {
    const x = yearX(year);
    layer.append(element("line", { x1: x, y1: 518, x2: x, y2: 524 }));
    const text = element("text", { x, y: 537, "text-anchor": "middle" });
    text.textContent = year;
    layer.append(text);
  });
  if (hasUndated) {
    const x = yearX(lastAxisYear);
    layer.append(element("line", { x1: x, y1: 518, x2: x, y2: 524 }));
    const text = element("text", { x, y: 537, "text-anchor": "middle" });
    text.textContent = "n.d.";
    layer.append(text);
  }
}

function prepareOverviewLayout() {
  connectedNodes = graph.nodes.filter(node => node.overview);
  const years = graph.nodes.map(node => node.year).filter(Number.isFinite);
  overviewYears = { first: Math.min(...years), last: Math.max(...years) };
  maximumInfluence = Math.max(...connectedNodes.map(node => node.in_degree));
  const yearX = year => 75 + 760 * (year - overviewYears.first) /
    Math.max(1, overviewYears.last + 1 - overviewYears.first);
  const predecessor = new Map(graph.nodes.map(node => [node.id, []]));
  const successor = new Map(graph.nodes.map(node => [node.id, []]));
  lineages.edges.forEach(edge => {
    predecessor.get(edge.target)?.push(edge.source);
    successor.get(edge.source)?.push(edge.target);
  });
  const layers = new Map();
  graph.nodes.forEach(node => {
    const year = Number.isFinite(node.year) ? node.year : overviewYears.last + 1;
    if (!layers.has(year)) layers.set(year, []);
    layers.get(year).push(node.id);
  });
  const layerYears = [...layers.keys()].sort((left, right) => left - right);
  const vertical = new Map(graph.nodes.map(node => [
    node.id, .06 + .88 * ((hash(node.id) % 1000) / 999)
  ]));
  const barycentricSweep = (orderedYears, neighbours) => {
    orderedYears.forEach(year => {
      const layer = layers.get(year);
      const desired = new Map(layer.map(id => {
        const related = neighbours.get(id).filter(other => nodes.get(other)?.year !== year);
        const average = related.length
          ? related.reduce((sum, other) => sum + vertical.get(other), 0) / related.length
          : vertical.get(id);
        return [id, .78 * average + .22 * vertical.get(id)];
      }));
      layer.sort((left, right) => desired.get(left) - desired.get(right) || left.localeCompare(right));
      const separation = Math.min(.055, .8 / Math.max(1, layer.length - 1));
      let previous = .03 - separation;
      layer.forEach(id => {
        const value = Math.max(desired.get(id), previous + separation);
        vertical.set(id, value);
        previous = value;
      });
      let next = .97 + separation;
      layer.slice().reverse().forEach(id => {
        const value = Math.min(vertical.get(id), next - separation);
        vertical.set(id, value);
        next = value;
      });
    });
  };
  for (let pass = 0; pass < 10; pass += 1) {
    barycentricSweep(layerYears, predecessor);
    barycentricSweep(layerYears.slice().reverse(), successor);
  }
  overviewPositions = new Map(graph.nodes.map(node => {
    const seed = hash(node.id);
    const year = Number.isFinite(node.year) ? node.year : overviewYears.last + 1;
    return [node.id, {
      x: yearX(year + ((seed % 101) / 100 - .5) * .38),
      y: 28 + 464 * vertical.get(node.id)
    }];
  }));
  const usedY = connectedNodes.map(node => overviewPositions.get(node.id).y);
  const minimumY = Math.min(...usedY);
  const maximumY = Math.max(...usedY);
  const middleY = (minimumY + maximumY) / 2;
  const scale = Math.min(1, 420 / Math.max(1, maximumY - minimumY));
  overviewPositions.forEach(point => {
    point.y = Math.max(34, Math.min(486, 260 + (point.y - middleY) * scale));
  });
}

function addFocusLabels(layer, localNodes, positions, selectedId, bounds) {
  placeGraphLabels(layer, localNodes, positions, selectedId, bounds, 34, 30);
}

function edgeAction(item, source, target) {
  item.setAttribute("role", "button");
  item.setAttribute("aria-label", `View citation from ${nodes.get(source).title} to ${nodes.get(target).title}`);
  item.addEventListener("click", () => showEvidence(source, target));
  // The same actions are ordinary buttons in the selected-work list.
  // Keep graph strokes out of the tab sequence rather than adding duplicate stops.
  item.setAttribute("tabindex", "-1");
}

function addFocusEdge(layer, source, target, positions, radii) {
  const line = shortenedLine(positions.get(source), positions.get(target), radii.get(source) + 2, radii.get(target) + 2);
  layer.append(element("line", { ...line, "marker-end": "url(#citationArrow)" }));
  const hit = element("line", { ...line, class: "citation-edge-hit" });
  edgeAction(hit, source, target);
  layer.append(hit);
}

function drawFocus(id) {
  const svg = $("#citationGraph");
  svg.replaceChildren();
  addDefinitions(svg);
  const axisLayer = element("g", { class: "citation-year-axis" });
  const edgeLayer = element("g", { class: "citation-graph-edges" });
  const nodeLayer = element("g", { class: "citation-graph-nodes" });
  const labelLayer = element("g", { class: "citation-graph-labels" });
  svg.append(axisLayer, edgeLayer, nodeLayer, labelLayer);
  const localIds = new Set([id, ...(outgoing.get(id) || []), ...(incoming.get(id) || [])]);
  const localNodes = [...localIds].map(workId => nodes.get(workId)).filter(Boolean);
  const positions = overviewPositions;
  const radii = new Map(localNodes.map(node => [node.id, nodeRadius(node, node.id === id)]));
  for (const target of outgoing.get(id) || []) addFocusEdge(edgeLayer, id, target, positions, radii);
  for (const source of incoming.get(id) || []) addFocusEdge(edgeLayer, source, id, positions, radii);
  localNodes.slice().sort((a, b) => Number(a.id === id) - Number(b.id === id)).forEach(node => {
    const point = positions.get(node.id);
    addNode(nodeLayer, node, point.x, point.y, radii.get(node.id), true, node.id === id);
  });
  const points = localNodes.map(node => positions.get(node.id));
  const minimumX = Math.min(...points.map(point => point.x));
  const maximumX = Math.max(...points.map(point => point.x));
  const width = Math.min(1000, Math.max(520, maximumX - minimumX + 330));
  const x = Math.max(0, Math.min(1000 - width, minimumX - 105));
  // Retain the shared year scale and its bottom axis when a neighbourhood is focused.
  const yearX = year => 75 + 760 * (year - overviewYears.first) /
    Math.max(1, overviewYears.last + 1 - overviewYears.first);
  addYearAxis(axisLayer, overviewYears.first, overviewYears.last, overviewYears.last + 1, yearX,
    localNodes.some(node => !Number.isFinite(node.year)));
  addFocusLabels(labelLayer, localNodes, positions, id, { left: x, right: x + width, top: 0, bottom: 510 });
  svg.setAttribute("viewBox", `${x.toFixed(1)} 0 ${width.toFixed(1)} 550`);
  $("#citationGraphCaption").textContent = "Arrows point from the citing work to the work it cites. Select a line or use View citation to read the linked passage.";
  renderConnectionsList(localNodes);
}

function drawOverview() {
  const svg = document.querySelector("#citationGraph");
  svg.replaceChildren();
  svg.setAttribute("viewBox", "0 0 1000 540");
  const axisLayer = element("g", { class: "citation-year-axis" });
  const edgeLayer = element("g", { class: "citation-graph-edges overview" });
  const nodeLayer = element("g", { class: "citation-graph-nodes overview" });
  const labelLayer = element("g", { class: "citation-graph-labels" });
  svg.append(axisLayer, edgeLayer, nodeLayer, labelLayer);
  const yearX = year => 75 + 760 * (year - overviewYears.first) /
    Math.max(1, overviewYears.last + 1 - overviewYears.first);
  addYearAxis(
    axisLayer, overviewYears.first, overviewYears.last,
    overviewYears.last + 1, yearX, connectedNodes.some(node => !Number.isFinite(node.year))
  );
  lineages.edges.filter(edge => edge.overview).forEach(edge => {
    const start = overviewPositions.get(edge.source);
    const end = overviewPositions.get(edge.target);
    if (start && end) {
      const d = branchingPath(start, end, 3, 3);
      edgeLayer.append(element("path", { d,
        class: edge.lineage_strength >= .72 ? "lineage-backbone" : "",
        "data-strength": edge.lineage_strength }));
      const hit = element("path", { d, class: "citation-edge-hit" });
      // Lineage orientation is chronological, while the direct citation points backwards.
      const direct = findEdge(edge.source, edge.target) || findEdge(edge.target, edge.source);
      if (direct) edgeAction(hit, direct.source, direct.target);
      edgeLayer.append(hit);
    }
  });
  connectedNodes
    .slice()
    .sort((left, right) => (left.in_degree + left.out_degree) - (right.in_degree + right.out_degree))
    .forEach(node => {
      const point = overviewPositions.get(node.id);
      const radius = nodeRadius(node);
      addNode(nodeLayer, node, point.x, point.y, radius, false, node.id === currentId);
    });
  addOverviewLabels(labelLayer);
  $("#citationGraphCaption").textContent = `${connectedNodes.length} of ${catalogueNodes.length} works appear in this selected network. Use Chronology to browse every work.`;
  renderConnectionsList(connectedNodes);
}

function updateViewButtons() {
  for (const [selector, view] of [["#citationTimelineView", "timeline"], ["#citationFocusView", "focus"], ["#citationOverviewView", "overview"]]) {
    const control = $(selector);
    if (!control) continue;
    control.classList.toggle("active", currentView === view);
    control.setAttribute("aria-pressed", String(currentView === view));
  }
  $("#citationFocusView").disabled = !currentId;
  $("#citationZoomOut").hidden = currentView !== "focus";
  if ($("#timelinePanel")) $("#timelinePanel").hidden = currentView !== "timeline";
  if ($("#connectionsPanel")) $("#connectionsPanel").hidden = currentView === "timeline";
}

function stateURL() {
  const parameters = new URLSearchParams();
  if (currentId) parameters.set("work", currentId);
  if (currentView !== "timeline" || currentId) parameters.set("view", currentView);
  if (searchQuery) parameters.set("q", searchQuery);
  if (decadeFilter !== "all") parameters.set("decade", decadeFilter);
  if (topicFilter !== "all") parameters.set("topic", topicFilter);
  if (selectedEdge) parameters.set("citation", selectedEdge.join("~"));
  return parameters.size ? `${location.pathname}?${parameters}` : location.pathname;
}

function updateURL(mode = "push") {
  const url = stateURL();
  if (url === location.pathname + (location.search || "")) return;
  history[mode === "replace" ? "replaceState" : "pushState"]({ timeline: true }, "", url);
}

function applyURLState() {
  const parameters = new URLSearchParams(location.search);
  const requested = parameters.get("work");
  currentId = requested && nodes.has(requested) ? requested : null;
  const view = parameters.get("view");
  currentView = view === "timeline" ? "timeline" : view === "overview" ? "overview" : currentId ? "focus" : "timeline";
  searchQuery = parameters.get("q") || "";
  const decade = parameters.get("decade") || "all";
  decadeFilter = decade === "undated" || catalogueNodes.some(node => String(Math.floor(node.year / 10) * 10) === decade) ? decade : "all";
  const topic = parameters.get("topic") || "all";
  topicFilter = catalogueNodes.some(node => node.category === topic) ? topic : "all";
  const edge = (parameters.get("citation") || "").split("~");
  selectedEdge = edge.length === 2 && findEdge(...edge) ? edge : null;
  $("#timelineDecade").value = decadeFilter;
  $("#timelineTopic").value = topicFilter;
}

function matchTitle(node, query) {
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  const title = normalized(`${node.title} ${node.year ?? ""}`);
  return terms.every(term => title.includes(term));
}

function chronologicalWorks(items = catalogueNodes) {
  return items.slice().sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || a.title.localeCompare(b.title));
}

function filteredWorks() {
  const exact = labels?.get(normalized(searchQuery));
  return chronologicalWorks(catalogueNodes.filter(node =>
    (exact ? exact.includes(node.id) : matchTitle(node, searchQuery)) &&
    (topicFilter === "all" || node.category === topicFilter) &&
    (decadeFilter === "all" || (decadeFilter === "undated" ? !Number.isFinite(node.year) : Math.floor(node.year / 10) * 10 === Number(decadeFilter)))
  ));
}

function editionActions(node) {
  return (node.edition_path ? `<a href="${esc(node.edition_path)}">Read edition</a>` : "") +
    (node.edition_pdf_path ? `<a href="${esc(node.edition_pdf_path)}" target="_blank" rel="noopener">Download PDF</a>` : "");
}

function renderChronology() {
  const items = filteredWorks();
  const groups = new Map();
  items.forEach(node => {
    const year = node.year ?? "Undated";
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(node);
  });
  $("#timelineList").innerHTML = [...groups].map(([year, entries]) =>
    `<section class="timeline-year"><h2>${esc(year)}</h2><ul>${entries.map(node =>
      `<li class="timeline-work"><a class="timeline-work-title" href="${esc(node.path)}">${esc(node.title)}</a>` +
      `<p class="timeline-work-meta">${esc(node.type)}${node.category ? ` · ${esc(node.category)}` : ""}</p>` +
      `<div class="timeline-work-actions">${editionActions(node)}<button type="button" data-work="${esc(node.id)}">Connections</button></div></li>`
    ).join("")}</ul></section>`
  ).join("") || '<p>No works match these filters. Clear them to see the complete chronology.</p>';
  bindWorkButtons($("#timelineList"));
  $("#timelineClear").hidden = !searchQuery && decadeFilter === "all" && topicFilter === "all";
  $("#citationStatus").textContent = `${items.length} of ${catalogueNodes.length} works, oldest first.`;
}

function renderConnectionsList(items) {
  $("#connectionsListItems").innerHTML = `<ul>${chronologicalWorks(items).map(node =>
    `<li><button type="button" data-work="${esc(node.id)}">${esc(node.year ?? "n.d.")} · ${esc(node.title)}</button></li>`
  ).join("")}</ul>`;
  bindWorkButtons($("#connectionsListItems"));
}

function bindWorkButtons(container) {
  container.querySelectorAll("button[data-work]").forEach(button => {
    button.onclick = () => activateNode(button.dataset.work);
  });
}

function findEdge(source, target) {
  return graph?.edges.find(edge => edge.source === source && edge.target === target);
}

function showEvidence(source, target, updateHistory = true, moveFocus = true) {
  const edge = findEdge(source, target);
  if (!edge) return;
  selectedEdge = [source, target];
  const panel = $("#citationEvidence");
  const passages = edge.passages || [];
  panel.hidden = false;
  panel.innerHTML = `<h2>Citation from ${esc(nodes.get(source).title)}</h2>` +
    `<p>Refers to <a href="${esc(nodes.get(target).path)}">${esc(nodes.get(target).title)}</a>.</p>` +
    (passages.length ? passages.map(passage =>
      `<div class="citation-evidence-item"><p class="citation-evidence-type">${passage.kind === "reference" ? "Bibliography entry" : "Citing passage"}</p>` +
      `<blockquote>${esc(passage.excerpt)}</blockquote><a href="${esc(passage.path)}">Read in context →</a></div>`
    ).join("") : `<p>This connection is recorded, but a linked passage is not available in the digital edition.</p>` +
      `<a href="${esc(nodes.get(source).path)}">View the citing work →</a>`);
  if (updateHistory) updateURL();
  if (moveFocus) {
    panel.focus({ preventScroll: true });
    panel.scrollIntoView({ behavior: "auto", block: "nearest" });
  }
}

function render(id, updateHistory = true) {
  const node = id ? nodes.get(id) : null;
  currentId = node?.id || null;
  if (currentView === "focus" && !node) currentView = "overview";
  updateViewButtons();
  $("#citationWork").value = currentView === "timeline" ? searchQuery : node ? label(node) : searchQuery;
  $("#citationMatches").hidden = true;
  $("#citationEvidence").hidden = true;
  const focus = $("#citationFocus");
  focus.hidden = !node;
  if (node) {
    const cites = [...(outgoing.get(id) || [])];
    const citedBy = [...(incoming.get(id) || [])];
    focus.innerHTML = `<div class="citation-focus-work"><span>${esc(node.year ?? "n.d.")} · ${esc(node.type || "Work")}</span>` +
      `<h2><a href="${esc(node.path)}">${esc(node.title)}</a></h2>` +
      `<div class="timeline-work-actions">${editionActions(node)}</div></div>` +
      `<div class="citation-neighbours"><section><h3>Cites <span>${cites.length}</span></h3>${cites.length ? neighbourList(cites, "outgoing") : "<p>None recorded.</p>"}</section>` +
      `<section><h3>Cited by <span>${citedBy.length}</span></h3>${citedBy.length ? neighbourList(citedBy, "incoming") : "<p>None recorded.</p>"}</section></div>`;
    bindWorkButtons(focus);
    focus.querySelectorAll("button[data-edge-source]").forEach(button => {
      button.onclick = () => showEvidence(button.dataset.edgeSource, button.dataset.edgeTarget);
    });
  }
  if (currentView === "timeline") renderChronology();
  else {
    if (currentView === "focus") drawFocus(id); else drawOverview();
    $("#citationStatus").textContent = node ? `Selected: ${label(node)}.` : "Select a work or search by any part of its title.";
    if (selectedEdge) showEvidence(...selectedEdge, false, false);
  }
  if (updateHistory) updateURL(updateHistory === "replace" ? "replace" : "push");
}

function searchConnections() {
  const query = $("#citationWork").value.trim();
  const exact = labels.get(normalized(query));
  const candidates = exact ? exact.map(id => nodes.get(id)) : graph.nodes.filter(node => matchTitle(node, query));
  if (query && candidates.length === 1) { activateNode(candidates[0].id); return; }
  const matches = $("#citationMatches");
  matches.hidden = false;
  matches.innerHTML = query && candidates.length ? `<ul>${chronologicalWorks(candidates).map(node =>
    `<li><button type="button" data-work="${esc(node.id)}">${esc(label(node))}</button></li>`
  ).join("")}</ul>` : query ? "<p>No matching work. Try another word from the title.</p>" : "<p>Enter part of a title to find matching works.</p>";
  bindWorkButtons(matches);
  $("#citationStatus").textContent = query && candidates.length ? `${candidates.length} matching works. Choose one below.`
    : query ? "No matching work. Try another word from the title." : "Enter part of a title to find matching works.";
}

async function init() {
  [graph, lineages] = await Promise.all([
    fetch("../data/citation-graph.json"), fetch("../data/citation-lineages.json")
  ]).then(async responses => {
    if (responses.some(response => !response.ok)) throw new Error("Citation data unavailable");
    return Promise.all(responses.map(response => response.json()));
  });
  catalogueNodes = graph.nodes.slice();
  const lineageNodes = new Map(lineages.nodes.map(node => [node.id, node]));
  graph.nodes = graph.nodes.map(node => ({ ...node, ...lineageNodes.get(node.id) }));
  nodes = new Map(graph.nodes.map(node => [node.id, node]));
  labels = new Map();
  for (const node of [...graph.nodes, ...catalogueNodes]) {
    for (const value of [label(node), node.title]) {
      const key = normalized(value);
      const ids = labels.get(key) || [];
      if (!ids.includes(node.id)) ids.push(node.id);
      labels.set(key, ids);
    }
  }
  outgoing = new Map(); incoming = new Map();
  graph.edges.forEach(edge => {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, new Set());
    if (!incoming.has(edge.target)) incoming.set(edge.target, new Set());
    outgoing.get(edge.source).add(edge.target); incoming.get(edge.target).add(edge.source);
  });
  outgoing.forEach((value, key) => outgoing.set(key, chronological(value)));
  incoming.forEach((value, key) => incoming.set(key, chronological(value)));
  prepareOverviewLayout();
  $("#citationWorkList").innerHTML = catalogueNodes.slice().sort((a, b) => a.title.localeCompare(b.title))
    .map(node => `<option value="${esc(label(node))}"></option>`).join("");
  const decades = [...new Set(catalogueNodes.filter(node => Number.isFinite(node.year)).map(node => Math.floor(node.year / 10) * 10))].sort((a, b) => a - b);
  $("#timelineDecade").innerHTML = '<option value="all">All years</option>' + decades.map(year => `<option value="${year}">${year}–${year + 9}</option>`).join("") +
    (catalogueNodes.some(node => !Number.isFinite(node.year)) ? '<option value="undated">Undated</option>' : "");
  $("#timelineTopic").innerHTML = '<option value="all">All topics</option>' + [...new Set(catalogueNodes.map(node => node.category).filter(Boolean))].sort()
    .map(topic => `<option value="${esc(topic)}">${esc(topic)}</option>`).join("");
  $("#citationSearch").onsubmit = event => {
    event.preventDefault();
    if (currentView === "timeline") { searchQuery = $("#citationWork").value.trim(); render(currentId, "replace"); }
    else searchConnections();
  };
  $("#citationWork").addEventListener("input", () => {
    if (currentView === "timeline") { searchQuery = $("#citationWork").value.trim(); renderChronology(); updateURL("replace"); }
  });
  for (const [selector, view] of [["#citationTimelineView", "timeline"], ["#citationOverviewView", "overview"], ["#citationFocusView", "focus"], ["#citationZoomOut", "overview"]]) {
    $(selector).onclick = () => { currentView = view; selectedEdge = null; render(currentId); };
  }
  $("#timelineDecade").onchange = event => { decadeFilter = event.target.value; render(currentId); };
  $("#timelineTopic").onchange = event => { topicFilter = event.target.value; render(currentId); };
  $("#timelineClear").onclick = () => {
    searchQuery = ""; decadeFilter = "all"; topicFilter = "all";
    $("#timelineDecade").value = "all"; $("#timelineTopic").value = "all";
    render(currentId);
    $("#citationWork").focus();
  };
  window.addEventListener("popstate", () => { applyURLState(); render(currentId, false); });
  applyURLState();
  render(currentId, false);
}

init().catch(() => {
  $("#citationStatus").textContent = "The timeline is unavailable. You can still browse the catalogue.";
});
