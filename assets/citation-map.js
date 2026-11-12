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
let currentView = "overview";

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

function neighbourList(ids) {
  const items = ids.map(id => nodes.get(id)).filter(Boolean);
  const render = values => `<ul>${values.map(node =>
    `<li><button type="button" data-work="${esc(node.id)}">${esc(node.title)}</button>` +
    `<span>${esc(node.year ?? "n.d.")}</span></li>`
  ).join("")}</ul>`;
  if (items.length <= 12) return render(items);
  return render(items.slice(0, 12)) +
    `<details><summary>${items.length - 12} more</summary>${render(items.slice(12))}</details>`;
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
  currentView = "focus";
  updateViewButtons();
  render(id);
}

function addNode(layer, node, x, y, radius, keyboard = true, selected = false) {
  const external = Number.isFinite(node.external_citations) ?
    ` External citations ${node.external_citations}.` : "";
  const item = element("g", {
    class: `citation-graph-node${selected ? " selected" : ""}`,
    transform: `translate(${x.toFixed(2)} ${y.toFixed(2)})`,
    role: "link",
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

function drawFocus(id) {
  const svg = document.querySelector("#citationGraph");
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
  const radii = new Map(localNodes.map(node => [
    node.id,
    nodeRadius(node, node.id === id)
  ]));
  for (const target of outgoing.get(id) || []) {
    const line = shortenedLine(positions.get(id), positions.get(target), radii.get(id) + 2, radii.get(target) + 2);
    edgeLayer.append(element("line", { ...line, "marker-end": "url(#citationArrow)" }));
  }
  for (const source of incoming.get(id) || []) {
    const line = shortenedLine(positions.get(source), positions.get(id), radii.get(source) + 2, radii.get(id) + 2);
    edgeLayer.append(element("line", { ...line, "marker-end": "url(#citationArrow)" }));
  }
  localNodes
    .slice()
    .sort((left, right) => Number(left.id === id) - Number(right.id === id))
    .forEach(node => {
      const point = positions.get(node.id);
      addNode(nodeLayer, node, point.x, point.y, radii.get(node.id), true, node.id === id);
  });
  const points = localNodes.map(node => positions.get(node.id));
  const minimumX = Math.min(...points.map(point => point.x));
  const maximumX = Math.max(...points.map(point => point.x));
  const minimumY = Math.min(...points.map(point => point.y));
  const maximumY = Math.max(...points.map(point => point.y));
  const width = Math.min(1000, Math.max(420, maximumX - minimumX + 330));
  const height = Math.min(540, Math.max(260, maximumY - minimumY + 180));
  const x = Math.max(0, Math.min(1000 - width, minimumX - 105));
  const y = Math.max(0, Math.min(540 - height, (minimumY + maximumY - height) / 2));
  addFocusLabels(labelLayer, localNodes, positions, id, {
    left: x, right: x + width, top: y, bottom: y + height
  });
  svg.setAttribute("viewBox", `${x.toFixed(1)} ${y.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}`);
  document.querySelector("#citationStatus").textContent = "";
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
    if (start && end) edgeLayer.append(element("path", {
      d: branchingPath(start, end, 3, 3),
      class: edge.lineage_strength >= .72 ? "lineage-backbone" : "",
      "data-strength": edge.lineage_strength
    }));
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
  document.querySelector("#citationStatus").textContent = "";
}

function updateViewButtons() {
  document.querySelector("#citationFocusView").classList.toggle("active", currentView === "focus");
  document.querySelector("#citationOverviewView").classList.toggle("active", currentView === "overview");
  document.querySelector("#citationFocusView").disabled = !currentId;
  document.querySelector("#citationZoomOut").hidden = currentView === "overview";
}

function updateURL() {
  const parameters = new URLSearchParams();
  if (currentId) parameters.set("work", currentId);
  if (currentView === "overview") parameters.set("view", "overview");
  history.replaceState(null, "", parameters.size ? `?${parameters}` : location.pathname);
}

function render(id, updateHistory = true) {
  const node = id ? nodes.get(id) : null;
  if (!node) {
    currentId = null;
    document.querySelector("#citationWork").value = "";
    document.querySelector("#citationFocus").hidden = true;
    currentView = "overview";
    updateViewButtons();
    drawOverview();
    if (updateHistory) updateURL();
    return;
  }
  currentId = id;
  document.querySelector("#citationWork").value = label(node);
  const cites = [...(outgoing.get(id) || [])];
  const citedBy = [...(incoming.get(id) || [])];
  const focus = document.querySelector("#citationFocus");
  focus.hidden = false;
  focus.innerHTML = `
    <div class="citation-focus-work">
      <span>${esc(node.year ?? "n.d.")}</span>
      <h2><a href="${esc(node.path)}">${esc(node.title)}</a></h2>
    </div>
    <div class="citation-neighbours">
      <section><h3>Cites <span>${cites.length}</span></h3>${cites.length ? neighbourList(cites) : "<p>None recorded.</p>"}</section>
      <section><h3>Cited by <span>${citedBy.length}</span></h3>${citedBy.length ? neighbourList(citedBy) : "<p>None recorded.</p>"}</section>
    </div>`;
  focus.querySelectorAll("button[data-work]").forEach(button => {
    button.onclick = () => activateNode(button.dataset.work);
  });
  if (currentView === "overview") drawOverview();
  else drawFocus(id);
  if (updateHistory) updateURL();
}

async function init() {
  [graph, lineages] = await Promise.all([
    fetch("../data/citation-graph.json"),
    fetch("../data/citation-lineages.json")
  ]).then(async responses => {
    if (responses.some(response => !response.ok)) throw new Error("Citation data unavailable");
    return Promise.all(responses.map(response => response.json()));
  });
  const lineageNodes = new Map(lineages.nodes.map(node => [node.id, node]));
  graph.nodes = graph.nodes.map(node => ({ ...node, ...lineageNodes.get(node.id) }));
  nodes = new Map(graph.nodes.map(node => [node.id, node]));
  labels = new Map(graph.nodes.map(node => [label(node).toLocaleLowerCase(), node.id]));
  outgoing = new Map();
  incoming = new Map();
  graph.edges.forEach(edge => {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, new Set());
    if (!incoming.has(edge.target)) incoming.set(edge.target, new Set());
    outgoing.get(edge.source).add(edge.target);
    incoming.get(edge.target).add(edge.source);
  });
  outgoing.forEach((value, key) => outgoing.set(key, chronological(value)));
  incoming.forEach((value, key) => incoming.set(key, chronological(value)));
  prepareOverviewLayout();
  document.querySelector("#citationWorkList").innerHTML = graph.nodes
    .slice().sort((a, b) => a.title.localeCompare(b.title))
    .map(node => `<option value="${esc(label(node))}"></option>`).join("");
  document.querySelector("#citationSearch").onsubmit = event => {
    event.preventDefault();
    const value = document.querySelector("#citationWork").value.trim().toLocaleLowerCase();
    const id = labels.get(value);
    if (id) activateNode(id);
    else document.querySelector("#citationStatus").textContent = "Choose a work from the list.";
  };
  document.querySelector("#citationFocusView").onclick = () => {
    currentView = "focus";
    updateViewButtons();
    render(currentId);
  };
  document.querySelector("#citationOverviewView").onclick = () => {
    currentView = "overview";
    updateViewButtons();
    render(currentId);
  };
  document.querySelector("#citationZoomOut").onclick = () => {
    currentView = "overview";
    updateViewButtons();
    render(currentId);
  };
  const parameters = new URLSearchParams(location.search);
  const requested = parameters.get("work");
  currentView = requested && nodes.has(requested) && parameters.get("view") !== "overview"
    ? "focus" : "overview";
  updateViewButtons();
  render(requested && nodes.has(requested) ? requested : null, false);
}

init().catch(() => {
  document.querySelector("#citationStatus").textContent = "Citation data is unavailable.";
});
