importScripts("article-search.js");

let indexPromise;

self.onmessage = async ({ data }) => {
  const { requestId, query } = data;
  try {
    indexPromise ||= fetch("article-search-index.json").then(response => {
      if (!response.ok) throw new Error(`Search index returned ${response.status}`);
      return response.json();
    });
    const index = await indexPromise;
    const result = self.TWArticleSearch.searchWorkSlugs(index, query);
    self.postMessage({ requestId, query, state: result.state, slugs: result.slugs });
  } catch (error) {
    self.postMessage({ requestId, query, state: "error", slugs: [] });
  }
};
