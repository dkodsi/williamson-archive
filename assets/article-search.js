(() => {
  const canonicalChar = character => {
    if (/\s/u.test(character)) return " ";
    if (/[‘’‚‛ʼ]/u.test(character)) return "'";
    if (/[“”„‟]/u.test(character)) return '"';
    return character.normalize("NFKC").toLocaleLowerCase();
  };

  const normalizeText = value => String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛ʼ]/gu, "'")
    .replace(/[“”„‟]/gu, '"')
    .replace(/\s+/gu, " ")
    .trim();

  const wordCharacter = value => Boolean(value && /[\p{L}\p{N}']/u.test(value));
  const termPattern = /(?<![\p{L}\p{N}'*])(\*)?([\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*)(\*)?(?![\p{L}\p{N}'*])/gu;

  const parseTerms = value => {
    const normalized = normalizeText(value);
    const terms = [];
    let capturedStars = 0;
    for (const match of normalized.matchAll(termPattern)) {
      const leading = Boolean(match[1]);
      const trailing = Boolean(match[3]);
      capturedStars += Number(leading) + Number(trailing);
      terms.push({
        value: match[2],
        mode: leading && trailing ? "contains" : leading ? "suffix" : trailing ? "prefix" : "whole",
      });
    }
    return capturedStars === (normalized.match(/\*/g) || []).length ? terms : null;
  };

  const occurrences = (haystack, value, mode = "phrase") => {
    const found = [];
    let offset = haystack.indexOf(value);
    while (offset >= 0) {
      const before = haystack[offset - 1] || "";
      const after = haystack[offset + value.length] || "";
      const startsWord = !wordCharacter(before);
      const endsWord = !wordCharacter(after);
      if (
        mode === "phrase" || mode === "contains" ||
        (mode === "whole" && startsWord && endsWord) ||
        (mode === "prefix" && startsWord) ||
        (mode === "suffix" && endsWord)
      ) found.push({ start: offset, end: offset + value.length });
      offset = haystack.indexOf(value, offset + 1);
    }
    return found;
  };

  const closestCluster = groups => {
    if (!groups.length || groups.some(group => !group.length)) return null;
    const flattened = groups.flatMap((group, groupIndex) =>
      group.map(match => ({ ...match, group: groupIndex }))
    ).sort((a, b) => a.start - b.start || a.end - b.end);
    const counts = Array(groups.length).fill(0);
    let covered = 0;
    let left = 0;
    let best = null;
    for (let right = 0; right < flattened.length; right += 1) {
      if (counts[flattened[right].group]++ === 0) covered += 1;
      while (covered === groups.length) {
        const window = flattened.slice(left, right + 1);
        const selected = groups.map((_, group) => window.find(match => match.group === group));
        const start = Math.min(...selected.map(match => match.start));
        const end = Math.max(...selected.map(match => match.end));
        if (!best || end - start < best.span || (end - start === best.span && start < best.start)) {
          best = {
            span: end - start,
            start,
            matches: selected.map(({ start: itemStart, end: itemEnd }) => ({ start: itemStart, end: itemEnd })),
          };
        }
        if (--counts[flattened[left].group] === 0) covered -= 1;
        left += 1;
      }
    }
    return best ? best.matches.sort((a, b) => a.start - b.start) : null;
  };

  const parseQuery = raw => {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return { state: "empty", phrases: [], terms: [], exactPhrase: "" };
    const quoteNormalized = trimmed.replace(/[“”„‟]/gu, '"');
    if ((quoteNormalized.match(/"/g) || []).length % 2) {
      return { state: "invalid", phrases: [], terms: [], exactPhrase: "" };
    }
    const phrases = [];
    let emptyPhrase = false;
    const outside = quoteNormalized.replace(/"([^"]*)"/g, (_, phrase) => {
      const normalized = normalizeText(phrase);
      if (normalized) phrases.push(normalized); else emptyPhrase = true;
      return " ";
    });
    const terms = parseTerms(outside);
    if (emptyPhrase || terms === null || (!phrases.length && !terms.length)) {
      return { state: "invalid", phrases: [], terms: [], exactPhrase: "" };
    }
    const exactPhrase = phrases.length || terms.some(term => term.mode !== "whole") || terms.length < 2
      ? "" : terms.map(term => term.value).join(" ");
    return { state: "ready", phrases, terms, exactPhrase };
  };

  const queryNeedles = (parsed, exact) => {
    if (parsed.state !== "ready") return [];
    const values = exact && parsed.exactPhrase
      ? [parsed.exactPhrase]
      : [...parsed.phrases, ...parsed.terms.map(term => term.value)];
    return [...new Set(values)];
  };

  const passageMatch = (text, parsed, normalized = normalizeText(text)) => {
    const groups = [
      ...parsed.phrases.map(phrase => occurrences(normalized, phrase)),
      ...parsed.terms.map(term => occurrences(normalized, term.value, term.mode)),
    ];
    let matches = closestCluster(groups);
    if (!matches) return null;
    let exact = parsed.phrases.length > 0;
    if (parsed.exactPhrase) {
      const exactMatches = occurrences(normalized, parsed.exactPhrase, "whole");
      if (exactMatches.length) {
        exact = true;
        matches = [exactMatches[0]];
      }
    }
    return { exact, matches, needles: queryNeedles(parsed, exact) };
  };

  const search = (index, raw) => {
    const parsed = parseQuery(raw);
    if (parsed.state !== "ready") return { state: parsed.state, parsed, results: [] };
    const exact = [];
    const ordinary = [];
    for (const work of index.works || []) {
      for (const passage of work.passages || []) {
        const normalized = passage[3] || (passage[3] = normalizeText(passage[2]));
        const match = passageMatch(passage[2], parsed, normalized);
        if (!match) continue;
        const result = {
          slug: work.slug,
          title: work.title,
          anchor: passage[0],
          section: passage[1],
          text: passage[2],
          needles: match.needles,
          matches: match.matches,
          exact: match.exact,
        };
        (match.exact ? exact : ordinary).push(result);
      }
    }
    return { state: "ready", parsed, results: [...exact, ...ordinary] };
  };

  const searchWorkSlugs = (index, raw) => {
    const parsed = parseQuery(raw);
    if (parsed.state !== "ready") return { state: parsed.state, slugs: [] };
    const slugs = [];
    for (const work of index.works || []) {
      for (const passage of work.passages || []) {
        const normalized = passage[3] || (passage[3] = normalizeText(passage[2]));
        if (passageMatch(passage[2], parsed, normalized)) {
          slugs.push(work.slug);
          break;
        }
      }
    }
    return { state: "ready", slugs };
  };

  const normalizedStringMap = value => {
    const map = [];
    let text = "";
    const source = String(value || "");
    for (let offset = 0; offset < source.length; offset += 1) {
      const normalized = canonicalChar(source[offset]);
      for (const character of normalized) {
        if (character === " " && (!text || text.endsWith(" "))) continue;
        text += character;
        map.push({ start: offset, end: offset + 1 });
      }
    }
    while (text.endsWith(" ")) { text = text.slice(0, -1); map.pop(); }
    return { text, map };
  };

  const normalizedTextMap = element => {
    const map = [];
    let text = "";
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement?.closest("annotation")
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let node;
    while ((node = walker.nextNode())) {
      for (let offset = 0; offset < node.data.length; offset += 1) {
        const normalized = canonicalChar(node.data[offset]);
        for (const character of normalized) {
          if (character === " " && (!text || text.endsWith(" "))) continue;
          text += character;
          map.push({ node, start: offset, end: offset + 1 });
        }
      }
    }
    while (text.endsWith(" ")) { text = text.slice(0, -1); map.pop(); }
    return { text, map };
  };

  const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);

  const snippet = result => {
    const mapped = normalizedStringMap(result.text);
    const matches = result.matches.map(match => {
      const first = mapped.map[match.start];
      const last = mapped.map[match.end - 1];
      return first && last ? { start: first.start, end: last.end } : null;
    }).filter(Boolean).sort((a, b) => a.start - b.start);
    if (!matches.length) return escapeHTML(result.text.slice(0, 200));

    const wordWindow = (from, to) => {
      let left = Math.max(0, from);
      let right = Math.min(result.text.length, to);
      if (left) {
        const boundary = result.text.indexOf(" ", left);
        left = boundary >= 0 && boundary < right ? boundary + 1 : left;
      }
      if (right < result.text.length) {
        const boundary = result.text.lastIndexOf(" ", right);
        right = boundary > left ? boundary : right;
      }
      return { left, right };
    };
    const renderWindow = window => {
      let output = "";
      let cursor = window.left;
      for (const match of matches.filter(item => item.start >= window.left && item.end <= window.right)) {
        output += escapeHTML(result.text.slice(cursor, match.start));
        output += `<mark>${escapeHTML(result.text.slice(match.start, match.end))}</mark>`;
        cursor = match.end;
      }
      return output + escapeHTML(result.text.slice(cursor, window.right));
    };

    const maximum = 320;
    const span = matches.at(-1).end - matches[0].start;
    let windows;
    if (span <= maximum) {
      const context = Math.max(18, Math.floor((maximum - span) / 2));
      windows = [wordWindow(matches[0].start - context, matches.at(-1).end + context)];
    } else {
      const matchLength = matches.reduce((total, match) => total + match.end - match.start, 0);
      const context = Math.max(18, Math.floor((maximum - matchLength) / (2 * matches.length)));
      windows = matches.map(match => wordWindow(match.start - context, match.end + context));
      windows = windows.reduce((merged, window) => {
        const previous = merged.at(-1);
        if (previous && window.left <= previous.right + 12) previous.right = Math.max(previous.right, window.right);
        else merged.push(window);
        return merged;
      }, []);
    }
    const leading = windows[0].left ? "…" : "";
    const trailing = windows.at(-1).right < result.text.length ? "…" : "";
    return leading + windows.map(renderWindow).join(" … ") + trailing;
  };

  const resultHref = (result, query) => {
    const exact = result.exact ? "&exact=1" : "";
    const match = result.matches.map(({ start, end }) => `${start}:${end}`).join(",");
    return `../editions/${encodeURIComponent(result.slug)}/index.html?search=${encodeURIComponent(query)}${exact}&match=${encodeURIComponent(match)}#${encodeURIComponent(result.anchor)}`;
  };

  const api = { normalizeText, normalizedStringMap, normalizedTextMap, parseQuery, queryNeedles, resultHref, search, searchWorkSlugs, snippet };
  globalThis.TWArticleSearch = api;
  if (typeof module !== "undefined") module.exports = api;

  if (typeof document === "undefined") return;
  const form = document.querySelector("[data-search-form]");
  if (!form) return;
  const input = form.querySelector("[data-search-input]");
  const status = document.querySelector("[data-search-status]");
  const region = document.querySelector("[data-search-results]");
  const list = region.querySelector("ol");
  const more = region.querySelector("[data-search-more]");
  let indexPromise;
  let current = [];
  let shown = 0;
  let submittedQuery = "";
  let requestId = 0;
  const pageSize = 40;

  const renderMore = () => {
    const next = current.slice(shown, shown + pageSize);
    for (const result of next) {
      const item = document.createElement("li");
      item.className = "fulltext-result";
      const label = result.section && result.section !== result.title
        ? `${result.title} · ${result.section}` : result.title;
      item.innerHTML = `<a href="${resultHref(result, submittedQuery)}"><span class="fulltext-result-meta">${escapeHTML(label)}</span><span class="fulltext-result-snippet">${snippet(result)}</span></a>`;
      list.appendChild(item);
    }
    shown += next.length;
    more.hidden = shown >= current.length;
    if (!more.hidden) more.textContent = `Show more (${current.length - shown} remaining)`;
  };
  const clearResults = () => {
    current = [];
    shown = 0;
    list.replaceChildren();
    region.hidden = true;
    more.hidden = true;
  };
  const loadIndex = () => indexPromise ||= fetch(form.dataset.searchIndex).then(response => {
    if (!response.ok) throw new Error("Search index unavailable");
    return response.json();
  }).catch(error => {
    indexPromise = undefined;
    throw error;
  });
  const updateURL = query => {
    const parameters = new URLSearchParams(location.search);
    if (query) parameters.set("q", query); else parameters.delete("q");
    const suffix = parameters.toString();
    const url = location.pathname + (suffix ? `?${suffix}` : "") + location.hash;
    if (url !== location.pathname + location.search + location.hash) {
      history.pushState(null, "", url);
    }
  };
  const run = async ({ updateHistory = true } = {}) => {
    const query = input.value.trim();
    const request = ++requestId;
    submittedQuery = query;
    clearResults();
    if (updateHistory) updateURL(query);
    const parsed = parseQuery(query);
    if (parsed.state === "empty") { status.textContent = "Enter a word or phrase."; return; }
    if (parsed.state === "invalid") { status.textContent = "Enter searchable words and close any quotation marks."; return; }
    status.textContent = "Loading search…";
    try {
      const index = await loadIndex();
      if (request !== requestId) return;
      const response = search(index, query);
      current = response.results;
      if (!current.length) { status.textContent = "No results."; return; }
      status.textContent = `${current.length.toLocaleString()} result${current.length === 1 ? "" : "s"}.`;
      region.hidden = false;
      renderMore();
    } catch (_) {
      if (request !== requestId) return;
      status.textContent = "Search is temporarily unavailable.";
    }
  };

  form.addEventListener("submit", event => { event.preventDefault(); return run(); });
  input.addEventListener("input", () => { if (input.value.trim()) loadIndex().catch(() => {}); });
  more.addEventListener("click", renderMore);
  window.addEventListener("popstate", () => {
    input.value = new URLSearchParams(location.search).get("q") || "";
    return run({ updateHistory: false });
  });
  const initial = new URLSearchParams(location.search).get("q");
  if (initial) { input.value = initial; run({ updateHistory: false }); }
})();
