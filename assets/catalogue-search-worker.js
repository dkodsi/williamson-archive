importScripts("article-search.js?v=20261112");

let indexPromise;
self.onmessage = async ({ data }) => {
  const { requestId, query, kind } = data;
  try {
    indexPromise ||= fetch("article-search-index.json").then(response => {
      if (!response.ok) throw new Error("Search index unavailable");
      return response.json();
    }).catch(error => { indexPromise = undefined; throw error; });
    const index = await indexPromise;
    const result = kind === "passages"
      ? self.TWArticleSearch.search(index, query)
      : self.TWArticleSearch.searchWorkSlugs(index, query);
    self.postMessage({ requestId, query, ...result });
  } catch (_) {
    self.postMessage({ requestId, query, state: "error", slugs: [], results: [] });
  }
};
