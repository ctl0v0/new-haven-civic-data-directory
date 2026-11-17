const BASE = "https://gis.newhavenct.gov/server/rest/services";

export default async function handler(request, response) {
  if (request.method !== "GET" || process.env.VERCEL_ENV !== "preview")
    return response.status(404).json({ error: "Not found" });
  const read = async (url) => {
    const result = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!result.ok) throw Error(`HTTP ${result.status}`);
    return result.json();
  };
  try {
    const root = await read(`${BASE}?f=json`);
    const folders = (root.folders ?? []).slice(0, 30);
    const catalog = await Promise.all(folders.map(async (folder) => {
      try {
        const listing = await read(`${BASE}/${encodeURIComponent(folder)}?f=json`);
        return { folder, matches: (listing.services ?? []).filter((item) =>
          /school|education|attendance|student|district/i.test(item.name)) };
      } catch (error) { return { folder, error: error.message }; }
    }));
    return response.status(200).json({ folders, matches: [
      ...(root.services ?? []).filter((item) => /school|education|attendance|student|district/i.test(item.name)),
      ...catalog.filter((item) => item.matches?.length || item.error),
    ] });
  } catch (error) {
    return response.status(502).json({ error: error.message });
  }
}
