const SOURCE = "https://gis.newhavenct.gov/server/rest/services/Hosted/Trash_Pickup_Day_%28View%29/FeatureServer";
const GIS = "https://gis.newhavenct.gov/server/rest/services/Hosted";
const SCHOOL_SOURCES = [
  `${GIS}/BM_AD_Board_Of_Education_Districts/FeatureServer`,
  `${GIS}/Board_of_Education_Districts_view/FeatureServer`,
];

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });
  if (process.env.VERCEL_ENV !== "preview") return response.status(404).json({ error: "Not found" });
  try {
    const check = new URL(request.url, "https://preview.invalid").searchParams.get("check");
    if (check === "trash-join") {
      const [{ loadParcel }, { getSourceRecords }] = await Promise.all([
        import("../../parcel/resolve.js"), import("../../parcel/adapters.js"),
      ]);
      const parcel = await loadParcel(10386);
      const source = await getSourceRecords("trash-pickup", parcel);
      return response.status(200).json({
        source_status: source.status,
        warning: source.warning,
        items: source.items.map((item) => ({ attributes: item.attributes, match: item.match })),
      });
    }
    if (check === "cmt") {
      const [{ loadParcel }, { getSourceRecords }] = await Promise.all([
        import("../../parcel/resolve.js"), import("../../parcel/adapters.js"),
      ]);
      const parcel = await loadParcel(10386);
      const source = await getSourceRecords("cmt-contacts", parcel);
      const cityPage = await fetch("https://www.newhavenct.gov/government/community-management-team", {
        signal: AbortSignal.timeout(8000),
      }).then((result) => ({ status: result.status, length: result.headers.get("content-length") })).catch((error) => ({ error: error.message }));
      return response.status(200).json({ source_status: source.status, items: source.items.map((item) => item.attributes), cityPage });
    }
    if (check === "attendance") {
      const url = "https://www.newhavenmagnetschools.com/index.php/enrollment/find-schools-in-your-attendance-zone";
      const upstream = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const html = await upstream.text();
      const { load } = await import("cheerio");
      const $ = load(html);
      return response.status(200).json({
        status: upstream.status,
        length: html.length,
        forms: $("form").toArray().map((form) => ({ action: $(form).attr("action"), method: $(form).attr("method"),
          inputs: $(form).find("input").toArray().map((input) => ({ name: $(input).attr("name"), type: $(input).attr("type"), value: $(input).attr("value") })).filter((input) => input.name),
        })),
        tables: $("table").toArray().map((table) => ({ class: $(table).attr("class"), id: $(table).attr("id"), text: $(table).text().replace(/\s+/g, " ").slice(0, 500) })).slice(0, 8),
        scripts: $("script[src]").toArray().map((script) => $(script).attr("src")).filter((src) => /joodb|search/i.test(src)),
        relevant_html: html.slice(Math.max(0, html.indexOf("STREET NAME") - 1000), html.indexOf("STREET NAME") + 3000),
      });
    }
    if (check === "schools") {
      const describe = async (source) => {
        try {
          const service = await (await fetch(`${source}?f=json`, { signal: AbortSignal.timeout(8000) })).json();
          const layers = await Promise.all((service.layers ?? []).map(async ({ id }) => {
            const url = `${source}/${id}`;
            const layer = await (await fetch(`${url}?f=json`, { signal: AbortSignal.timeout(8000) })).json();
            const query = new URL(`${url}/query`);
            query.search = new URLSearchParams({ f: "json", where: "1=1", outFields: "*", returnGeometry: "false", resultRecordCount: "2" });
            const sample = await (await fetch(query, { signal: AbortSignal.timeout(8000) })).json();
            return { id, name: layer.name, description: layer.description,
              fields: layer.fields?.map(({ name, alias, type, domain }) => ({ name, alias, type, domain })),
              editing_info: layer.editingInfo, sample: sample.features?.map((item) => item.attributes),
              error: layer.error ?? sample.error ?? null };
          }));
          return { source, service_layers: service.layers, layers, error: service.error ?? null };
        } catch (error) { return { source, error: error.message }; }
      };
      const [directory, ...sources] = await Promise.all([
        fetch(`${GIS}?f=json`, { signal: AbortSignal.timeout(8000) })
          .then((res) => res.json())
          .then((data) => (data.services ?? []).filter((service) => /school|education|attendance|nhps/i.test(service.name)))
          .catch(() => null),
        ...SCHOOL_SOURCES.map(describe),
      ]);
      return response.status(200).json({ directory, sources });
    }
    const serviceResponse = await fetch(`${SOURCE}?f=json`, { signal: AbortSignal.timeout(8000) });
    const service = await serviceResponse.json();
    const layerId = service.layers?.[0]?.id;
    if (layerId == null) return response.status(502).json({ status: serviceResponse.status, error: service.error ?? "No layers published" });
    const layerResponse = await fetch(`${SOURCE}/${layerId}?f=json`, { signal: AbortSignal.timeout(8000) });
    const layer = await layerResponse.json();
    const query = new URL(`${SOURCE}/${layerId}/query`);
    query.search = new URLSearchParams({
      f: "json",
      geometry: JSON.stringify({ x: -72.9096569, y: 41.3159061, spatialReference: { wkid: 4326 } }),
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "objectid,trash_day",
      returnGeometry: "false",
    });
    const sampleResponse = await fetch(query, { signal: AbortSignal.timeout(8000) });
    const sample = await sampleResponse.json();
    return response.status(200).json({
      source: SOURCE,
      service_status: serviceResponse.status,
      service_layers: service.layers,
      service_editing_info: service.editingInfo ?? null,
      layer_status: layerResponse.status,
      name: layer.name,
      description: layer.description,
      fields: layer.fields?.map(({ name, alias, type, domain }) => ({ name, alias, type, domain })),
      editing_info: layer.editingInfo ?? null,
      sample_point_zone: sample.features?.map((feature) => feature.attributes) ?? null,
      sample_error: sample.error ?? null,
      error: layer.error ?? null,
    });
  } catch (error) {
    return response.status(502).json({ error: error.message });
  }
}
