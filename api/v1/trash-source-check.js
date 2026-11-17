const SOURCE = "https://gis.newhavenct.gov/server/rest/services/Hosted/Trash_Pickup_Day_%28View%29/FeatureServer";

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });
  if (process.env.VERCEL_ENV !== "preview") return response.status(404).json({ error: "Not found" });
  try {
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
