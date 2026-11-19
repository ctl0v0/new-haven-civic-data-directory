import { indexQuery } from "./db.js";
import { arcgisInventory, arcgisFeatures } from "./arcgis.js";
import { INDEX_DATASETS } from "./catalog.js";
import { stateRosterInventory, stateRosterRows, STATE_ROSTERS } from "./socrata.js";
import { municipalPermitCatalogRows, municipalPermitTypeRows,
  sameMunicipalPermitRows, municipalDateSearchFormat, municipalPermitDateRows,
  municipalParentPrintKey } from "./municity.js";
import { recentCalendarDates } from "./ask.js";
import nhpsSnapshot from "../data/nhps-attendance.json" with { type: "json" };
import { municipalPermitTypes } from "../parcel/permit-types.js";
import { NHPS_ATTENDANCE_URL, normalizeSchoolStreet, schoolAddress,
  schoolRowsForAddress, snapshotIsCurrent } from "../parcel/school-attendance.js";

const write = (statement, values = []) => indexQuery(statement, values, { write: true });

export async function beginRun(sourceId, scopeKey = "all", expectedCount = null,
  sourceUpdatedAt = null, coverageDates = null) {
  const rows = await write(`INSERT INTO search_source_runs
    (source_id, scope_key, status, expected_count, source_updated_at,
      coverage_date_from, coverage_date_to)
    VALUES ($1, $2, 'running', $3, $4, $5, $6) RETURNING id`,
  [sourceId, scopeKey, expectedCount, sourceUpdatedAt,
    coverageDates?.from ?? null, coverageDates?.to ?? null]);
  return Number(rows[0].id);
}

async function setRunInventory(runId, expectedCount, sourceUpdatedAt = null) {
  await write(`UPDATE search_source_runs SET expected_count = $2,
    source_updated_at = $3 WHERE id = $1 AND status = 'running'`,
  [runId, expectedCount, sourceUpdatedAt]);
}

export async function insertRecords(runId, sourceId, records) {
  if (!records.length) return;
  const payload = records.map((record) => ({
    record_id: String(record.record_id), source_url: String(record.source_url),
    published_type: record.published_type ?? null,
    published_status: record.published_status ?? null,
    event_date: record.event_date ?? null,
    fields: record.fields ?? {},
    geometry: record.geometry ? JSON.stringify(record.geometry) : null,
  }));
  await write(`INSERT INTO search_records
    (run_id, source_id, record_id, source_url, published_type,
      published_status, event_date, fields, geometry)
    SELECT $1::bigint, $2::text, x.record_id, x.source_url,
      x.published_type, x.published_status, x.event_date::date, x.fields,
      CASE WHEN x.geometry IS NULL THEN NULL
        ELSE ST_SetSRID(ST_GeomFromGeoJSON(x.geometry), 4326) END
    FROM jsonb_to_recordset($3::jsonb) AS x
      (record_id text, source_url text, published_type text,
       published_status text, event_date text, fields jsonb, geometry text)`,
  [runId, sourceId, JSON.stringify(payload)]);
}

async function linkCityParcels(runId) {
  await write(`INSERT INTO search_record_parcels
    (run_id, source_id, record_id, city_parcel_id, city_objectid, match_method)
    SELECT $1, 'parcels', record_id,
      (fields->>'parcel_id')::bigint, (fields->>'objectid')::bigint,
      'city-parcel-record'
    FROM search_records WHERE run_id = $1 AND source_id = 'parcels'
      AND NULLIF(fields->>'parcel_id', '') IS NOT NULL`, [runId]);
}

async function linkSpatial(runId, sourceId, { addressZone = false } = {}) {
  const parcelRun = await write(`SELECT run_id FROM search_active_runs
    WHERE source_id = 'parcels' AND scope_key = 'all'`);
  if (!parcelRun.length) throw new Error("Complete City parcel baseline is required before spatial joins");
  const parcelId = Number(parcelRun[0].run_id);
  if (addressZone) {
    const addressRun = await write(`SELECT run_id FROM search_active_runs
      WHERE source_id = 'addresses' AND scope_key = 'all'`);
    if (!addressRun.length) throw new Error("Complete City address baseline is required before trash zones");
    await write(`WITH zone_counts AS (
      SELECT a.record_id AS address_id, COUNT(DISTINCT z.record_id) AS zone_count
      FROM search_records z
      JOIN search_records a ON a.run_id = $2 AND a.source_id = 'addresses'
        AND ST_Intersects(z.geometry, a.geometry)
      WHERE z.run_id = $1 AND z.source_id = 'trash-pickup'
      GROUP BY a.record_id
    ), candidates AS (
      SELECT z.run_id, z.source_id, z.record_id, a.record_id AS address_id,
        ap.city_parcel_id, ap.city_objectid, ap.join_status AS address_join_status,
        zc.zone_count
      FROM search_records z
      JOIN search_records a ON a.run_id = $2 AND a.source_id = 'addresses'
        AND ST_Intersects(z.geometry, a.geometry)
      JOIN zone_counts zc ON zc.address_id = a.record_id
      JOIN search_record_parcels ap ON ap.run_id = a.run_id
        AND ap.source_id = 'addresses' AND ap.record_id = a.record_id
      WHERE z.run_id = $1 AND z.source_id = 'trash-pickup'
    )
    INSERT INTO search_record_parcels (run_id, source_id, record_id,
      city_parcel_id, city_objectid, city_address_objectid, match_method, join_status)
    SELECT run_id, source_id, record_id, city_parcel_id, city_objectid,
      address_id::bigint, 'city-address-point-zone-intersection',
      CASE WHEN zone_count = 1 AND address_join_status = 'exact'
        THEN 'exact' ELSE 'ambiguous' END
    FROM candidates`, [runId, Number(addressRun[0].run_id)]);
    return;
  }
  await write(`WITH hits AS (
    SELECT r.run_id, r.source_id, r.record_id,
      (p.fields->>'parcel_id')::bigint AS city_parcel_id,
      (p.fields->>'objectid')::bigint AS city_objectid,
      COUNT(*) OVER (PARTITION BY r.record_id) AS hit_count
    FROM search_records r
    JOIN search_records p ON p.run_id = $2 AND p.source_id = 'parcels'
      AND ST_Intersects(r.geometry, p.geometry)
    WHERE r.run_id = $1 AND r.source_id = $3
  )
  INSERT INTO search_record_parcels (run_id, source_id, record_id,
    city_parcel_id, city_objectid, match_method, join_status)
  SELECT run_id, source_id, record_id, city_parcel_id, city_objectid,
    $4, CASE WHEN $3 = 'addresses' AND hit_count <> 1
      THEN 'ambiguous' ELSE 'exact' END
  FROM hits WHERE city_parcel_id IS NOT NULL`, [runId, parcelId, sourceId,
    sourceId === "addresses" ? "address-point-intersection" : "parcel-polygon-intersection"]);
}

async function linkExactParcelKey(runId, sourceId, keyField, { mbluOnly = false } = {}) {
  const parcelRun = await write(`SELECT run_id FROM search_active_runs
    WHERE source_id = 'parcels' AND scope_key = 'all'`);
  if (!parcelRun.length) throw new Error("Complete City parcel baseline is required for exact parcel joins");
  await write(`INSERT INTO search_record_parcels
    (run_id, source_id, record_id, city_parcel_id, city_objectid, match_method, join_status)
    SELECT r.run_id, r.source_id, r.record_id,
      (p.fields->>'parcel_id')::bigint, (p.fields->>'objectid')::bigint,
      'published-parcel-key-exact',
      CASE WHEN COUNT(*) OVER (PARTITION BY r.record_id) = 1
        THEN 'exact' ELSE 'ambiguous' END
    FROM search_records r
    JOIN search_records p ON p.run_id = $2 AND p.source_id = 'parcels'
      AND NULLIF(p.fields->>'parcel_id', '') IS NOT NULL
      AND (${mbluOnly ? "" : "upper(trim(r.fields->>$3)) = upper(p.fields->>'parcel_id') OR"}
        regexp_replace(upper(replace(r.fields->>$3, '/', ' ')), '[[:space:]]+', ' ', 'g') =
        regexp_replace(upper(replace(p.fields->>'mblu', '/', ' ')), '[[:space:]]+', ' ', 'g'))
    WHERE r.run_id = $1 AND r.source_id = $4`,
  [runId, Number(parcelRun[0].run_id), keyField, sourceId]);
}

async function linkAdditionalMunicipalKey(runId, keyField) {
  const parcelRun = await write(`SELECT run_id FROM search_active_runs
    WHERE source_id = 'parcels' AND scope_key = 'all'`);
  if (!parcelRun.length) throw new Error("Complete City parcel baseline is required for permit joins");
  await write(`INSERT INTO search_record_parcels
    (run_id, source_id, record_id, city_parcel_id, city_objectid, match_method, join_status)
    SELECT r.run_id, r.source_id, r.record_id,
      (p.fields->>'parcel_id')::bigint, (p.fields->>'objectid')::bigint,
      $4, CASE WHEN COUNT(*) OVER (PARTITION BY r.record_id) = 1
        THEN 'exact' ELSE 'ambiguous' END
    FROM search_records r JOIN search_records p
      ON p.run_id = $2 AND p.source_id = 'parcels'
      AND regexp_replace(upper(replace(r.fields->>$3, '/', ' ')), '[[:space:]]+', ' ', 'g') =
        regexp_replace(upper(replace(p.fields->>'mblu', '/', ' ')), '[[:space:]]+', ' ', 'g')
    WHERE r.run_id = $1 AND r.source_id = 'municity'
      AND NULLIF(trim(r.fields->>$3), '') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM search_record_parcels j
        WHERE j.run_id = r.run_id AND j.source_id = r.source_id AND j.record_id = r.record_id)`,
  [runId, Number(parcelRun[0].run_id), keyField,
    keyField === "PrintKey_Parcel" ? "published-permit-parent-key-exact" : "verified-municipal-parent-key-exact"]);
}

async function linkStateAddresses(runId, sourceId) {
  const addressRun = await write(`SELECT run_id FROM search_active_runs
    WHERE source_id = 'addresses' AND scope_key = 'all'`);
  if (!addressRun.length) throw new Error("Complete City address baseline is required for State site joins");
  await write(`WITH matches AS (
    SELECT r.run_id, r.source_id, r.record_id, a.record_id AS address_id,
      ap.city_parcel_id, ap.city_objectid, ap.join_status
    FROM search_records r
    JOIN search_records a ON a.run_id = $2 AND a.source_id = 'addresses'
      AND a.fields->>'normalized_address' = r.fields->>'normalized_site_address'
    JOIN search_record_parcels ap ON ap.run_id = a.run_id
      AND ap.source_id = 'addresses' AND ap.record_id = a.record_id
    WHERE r.run_id = $1 AND r.source_id = $3
      AND length(r.fields->>'normalized_site_address') > 0
  ), flags AS (
    SELECT record_id, COUNT(DISTINCT (city_parcel_id, city_objectid)) AS parcel_count,
      bool_and(join_status = 'exact') AS address_exact
    FROM matches GROUP BY record_id
  )
  INSERT INTO search_record_parcels (run_id, source_id, record_id,
    city_parcel_id, city_objectid, city_address_objectid, match_method, join_status)
  SELECT m.run_id, m.source_id, m.record_id, m.city_parcel_id,
    m.city_objectid, m.address_id::bigint, 'state-site-city-address-point',
    CASE WHEN f.parcel_count = 1 AND f.address_exact THEN 'exact' ELSE 'ambiguous' END
  FROM matches m JOIN flags f ON f.record_id = m.record_id`,
  [runId, Number(addressRun[0].run_id), sourceId]);
}

export async function finishRun(runId, sourceId, expectedCount, { sourceWarning = null } = {}) {
  const count = await write(`SELECT COUNT(*)::integer AS n FROM search_records WHERE run_id = $1`, [runId]);
  const returned = Number(count[0].n);
  if (returned !== expectedCount) throw new Error(`Source count ${expectedCount} differs from indexed count ${returned}`);
  if (sourceId === "parcels") await linkCityParcels(runId);
  else if (sourceId === "ct-brownfields") await linkExactParcelKey(runId, sourceId, "Site_Parce");
  else if (sourceId === "managed-lots") await linkExactParcelKey(runId, sourceId, "mbp");
  else if (sourceId === "municity") {
    await linkExactParcelKey(runId, sourceId, "PrintKey", { mbluOnly: true });
    await linkAdditionalMunicipalKey(runId, "PrintKey_Parcel");
    await linkAdditionalMunicipalKey(runId, "VerifiedParentPrintKey");
  }
  else if (["school-attendance", "municity-permit-types"].includes(sourceId)) {
    /* School rows are linked during import; catalog rows do not describe parcels. */
  }
  else if (STATE_ROSTERS[sourceId]) await linkStateAddresses(runId, sourceId);
  else if (sourceId === "trash-pickup") await linkSpatial(runId, sourceId, { addressZone: true });
  else if (!["metered-parking-spaces", "transit-stops"].includes(sourceId))
    await linkSpatial(runId, sourceId);
  const statistics = await write(`SELECT COUNT(*)::integer AS linked,
    COUNT(*) FILTER (WHERE join_status = 'ambiguous')::integer AS ambiguous
    FROM search_record_parcels WHERE run_id = $1`, [runId]);
  const linked = Number(statistics[0].linked);
  const ambiguous = Number(statistics[0].ambiguous);
  const distinctLinked = Number((await write(`SELECT COUNT(DISTINCT record_id)::integer AS n
    FROM search_record_parcels WHERE run_id = $1`, [runId]))[0].n);
  const unlinked = ["metered-parking-spaces", "transit-stops", "municity-permit-types"].includes(sourceId)
    ? 0 : Math.max(0, returned - distinctLinked);
  const warning = [sourceId === "parcels" && unlinked > 0
    ? `${unlinked} official City parcel features lack a published parcel ID`
    : null, sourceWarning].filter(Boolean).join("; ") || null;
  await write(`WITH finished AS (
    UPDATE search_source_runs SET status = 'complete', finished_at = now(),
      returned_count = $2, linked_count = $3, ambiguous_count = $4,
      unlinked_count = $5, warning = $6
    WHERE id = $1 AND status = 'running' RETURNING id, source_id, scope_key
  )
  INSERT INTO search_active_runs (source_id, scope_key, run_id)
  SELECT source_id, scope_key, id FROM finished
  ON CONFLICT (source_id, scope_key) DO UPDATE SET run_id = EXCLUDED.run_id`,
  [runId, returned, linked, ambiguous, unlinked, warning]);
  return { run_id: runId, returned, linked, ambiguous, unlinked };
}

export async function failRun(runId, error) {
  const reason = String(error?.message ?? error);
  const warning = error?.code === "MUNICIPAL_TYPE_CAP"
    ? `${error.code}: ${reason}` : reason;
  await write(`UPDATE search_source_runs SET status = 'failed', finished_at = now(),
    warning = $2 WHERE id = $1 AND status = 'running'`,
  [runId, warning.slice(0, 500)]);
}

export async function importArcgisSource(sourceId) {
  const definition = INDEX_DATASETS[sourceId];
  if (definition?.kind !== "arcgis")
    throw new Error("Unknown GIS index source");
  const runId = await beginRun(sourceId);
  try {
    const inventory = await arcgisInventory(sourceId);
    await setRunInventory(runId, inventory.source_count, inventory.source_updated_at);
    for (let at = 0; at < inventory.object_ids.length; at += 200) {
      const rows = await arcgisFeatures(inventory, inventory.object_ids.slice(at, at + 200));
      await insertRecords(runId, sourceId, rows);
    }
    const finalInventory = await arcgisInventory(sourceId);
    if (finalInventory.source_count !== inventory.source_count ||
        finalInventory.source_updated_at !== inventory.source_updated_at ||
        finalInventory.object_ids.some((id, index) => id !== inventory.object_ids[index]))
      throw new Error("Official GIS IDs or publisher update time changed during refresh");
    return await finishRun(runId, sourceId, inventory.source_count);
  } catch (error) {
    await failRun(runId, error);
    throw error;
  }
}

export async function importStateRoster(sourceId) {
  if (!STATE_ROSTERS[sourceId]) throw new Error("Unknown State roster index source");
  const runId = await beginRun(sourceId);
  try {
    const inventory = await stateRosterInventory(sourceId);
    await setRunInventory(runId, inventory.source_count, inventory.source_updated_at);
    const ids = new Set();
    for (let offset = 0; offset < inventory.source_count; offset += 500) {
      const records = await stateRosterRows(inventory, offset);
      for (const record of records) {
        if (ids.has(record.record_id)) throw new Error("State roster repeated an official row ID");
        ids.add(record.record_id);
      }
      await insertRecords(runId, sourceId, records);
    }
    const finalInventory = await stateRosterInventory(sourceId);
    if (finalInventory.source_count !== inventory.source_count ||
        finalInventory.source_updated_at !== inventory.source_updated_at)
      throw new Error("State roster count or publisher update time changed during refresh");
    return await finishRun(runId, sourceId, inventory.source_count);
  } catch (error) {
    await failRun(runId, error);
    throw error;
  }
}

export async function importMunicipalPermitType(permitType) {
  const type = String(permitType ?? "").trim();
  if (!type || type.length > 100) throw new Error("Provide one official municipal permit type");
  const scopeKey = `permit-type:${type.toUpperCase()}`;
  const runId = await beginRun("municity", scopeKey);
  try {
    const first = await municipalPermitTypeRows(type);
    await setRunInventory(runId, first.rows.length);
    for (let offset = 0; offset < first.rows.length; offset += 200)
      await insertRecords(runId, "municity", first.rows.slice(offset, offset + 200));
    const final = await municipalPermitTypeRows(permitType);
    if (!sameMunicipalPermitRows(first.rows, final.rows))
      throw new Error("Municipal permit type changed during refresh");
    const sourceWarning = first.duplicate_rows
      ? `Municipal search returned ${first.vendor_count} rows, including ${first.duplicate_rows} repeated Permit_ID rows; indexed published fields were reconciled only where nonblank values did not conflict`
      : null;
    return { ...await finishRun(runId, "municity", first.rows.length, { sourceWarning }),
      vendor_rows: first.vendor_count, repeated_rows: first.duplicate_rows };
  } catch (error) {
    await failRun(runId, error);
    throw error;
  }
}

export async function importMunicipalRecentElectrical({ now = new Date(),
  dateFormat = municipalDateSearchFormat, dateRows = municipalPermitDateRows,
  parentKey = municipalParentPrintKey } = {}) {
  const type = "Electrical Permit";
  const range = recentCalendarDates(30, now);
  const runId = await beginRun("municity", `permit-type:${type.toUpperCase()}`,
    null, null, range);
  try {
    const format = await dateFormat(type);
    const days = Array.from({ length: 30 }, (_, index) =>
      new Date(Date.parse(`${range.from}T00:00:00Z`) + index * 86400_000)
        .toISOString().slice(0, 10));
    const first = [];
    const dailyCounts = [];
    for (const day of days) {
      const result = await dateRows(day, type, format);
      first.push(...result.rows);
      dailyCounts.push(result.vendor_count);
    }
    const ids = new Set(first.map((row) => row.record_id));
    if (ids.size !== first.length || first.some((row) => row.event_date == null))
      throw new Error("Recent Electrical Permit window has duplicate IDs across dates or an undated row");
    const parents = new Map();
    for (const row of first) {
      const key = (value) => String(value ?? "").replaceAll("/", " ")
        .trim().replace(/\s+/g, " ").toUpperCase();
      if (key(row.fields.PrintKey) && key(row.fields.PrintKey_Parcel) &&
          key(row.fields.PrintKey) !== key(row.fields.PrintKey_Parcel))
        throw new Error(`Municipal permit ${row.record_id} publishes conflicting parcel keys`);
      if (row.fields.PrintKey || !row.fields.Parcel_ID) continue;
      const id = String(row.fields.Parcel_ID);
      if (!parents.has(id)) {
        try { parents.set(id, await parentKey(id)); }
        catch { parents.set(id, null); }
      }
      if (parents.get(id)) row.fields.VerifiedParentPrintKey = parents.get(id);
      if (key(row.fields.PrintKey_Parcel) && key(row.fields.VerifiedParentPrintKey) &&
          key(row.fields.PrintKey_Parcel) !== key(row.fields.VerifiedParentPrintKey))
        throw new Error(`Municipal permit ${row.record_id} disagrees with its verified parent parcel`);
    }
    await setRunInventory(runId, first.length);
    for (let offset = 0; offset < first.length; offset += 200)
      await insertRecords(runId, "municity", first.slice(offset, offset + 200));
    const second = [];
    for (const [index, day] of days.entries()) {
      const result = await dateRows(day, type, format);
      if (result.vendor_count !== dailyCounts[index])
        throw new Error("Municipal daily permit count changed during refresh");
      second.push(...result.rows);
    }
    for (const row of second)
      if (parents.get(String(row.fields.Parcel_ID)))
        row.fields.VerifiedParentPrintKey = parents.get(String(row.fields.Parcel_ID));
    if (!sameMunicipalPermitRows(first, second))
      throw new Error("Municipal recent permit rows changed during refresh");
    return { ...await finishRun(runId, "municity", first.length),
      coverage_date_from: range.from, coverage_date_to: range.to,
      daily_counts: dailyCounts };
  } catch (error) {
    await failRun(runId, error);
    throw error;
  }
}

export async function importMunicipalPermitCatalog() {
  const runId = await beginRun("municity-permit-types");
  try {
    const listed = await municipalPermitTypes();
    const rows = municipalPermitCatalogRows(listed);
    await setRunInventory(runId, rows.length);
    for (let offset = 0; offset < rows.length; offset += 200)
      await insertRecords(runId, "municity-permit-types", rows.slice(offset, offset + 200));
    return await finishRun(runId, "municity-permit-types", rows.length);
  } catch (error) {
    await failRun(runId, error);
    throw error;
  }
}

export async function importSchoolAttendance() {
  const runId = await beginRun("school-attendance");
  try {
    if (!snapshotIsCurrent())
      throw new Error("Official NHPS attendance snapshot failed freshness or integrity checks");
    const addressRunRows = await write(`SELECT run_id FROM search_active_runs
      WHERE source_id = 'addresses' AND scope_key = 'all'`);
    if (!addressRunRows.length) throw new Error("Complete City address baseline is required for NHPS joins");
    const addressRun = Number(addressRunRows[0].run_id);
    const rows = nhpsSnapshot.rows;
    if (new Set(rows.map((row) => row.id)).size !== rows.length)
      throw new Error("Official NHPS snapshot repeats a published row ID");
    await setRunInventory(runId, rows.length);
    const byStreet = new Map();
    for (const row of rows) {
      const street = normalizeSchoolStreet(row.street_name);
      if (!byStreet.has(street)) byStreet.set(street, []);
      byStreet.get(street).push(row);
    }
    for (let offset = 0; offset < rows.length; offset += 200)
      await insertRecords(runId, "school-attendance", rows.slice(offset, offset + 200)
        .map((row) => ({ record_id: row.id, source_url: NHPS_ATTENDANCE_URL,
          fields: row })));
    let after = 0;
    for (;;) {
      const addresses = await write(`SELECT record_id, fields FROM search_records
        WHERE run_id = $1 AND source_id = 'addresses' AND record_id::bigint > $2
        ORDER BY record_id::bigint LIMIT 500`, [addressRun, after]);
      if (!addresses.length) break;
      after = Number(addresses.at(-1).record_id);
      const joins = await write(`SELECT record_id, city_parcel_id, city_objectid, join_status
        FROM search_record_parcels WHERE run_id = $1 AND source_id = 'addresses'
          AND record_id = ANY($2::text[])`, [addressRun, addresses.map((a) => a.record_id)]);
      const byAddress = new Map();
      for (const join of joins) {
        if (!byAddress.has(join.record_id)) byAddress.set(join.record_id, []);
        byAddress.get(join.record_id).push(join);
      }
      const links = [];
      for (const row of addresses) {
        const address = schoolAddress(`${row.fields.house_number ?? ""} ${row.fields.full_street_name ?? ""}`);
        if (!address) continue;
        const lookup = schoolRowsForAddress(byStreet.get(address.street) ?? [], address);
        for (const school of lookup.rows) for (const join of byAddress.get(row.record_id) ?? [])
          links.push({ record_id: String(school.id), address_id: Number(row.record_id),
            city_parcel_id: Number(join.city_parcel_id), city_objectid: Number(join.city_objectid),
            join_status: lookup.status === "matched" && join.join_status === "exact"
              ? "exact" : "ambiguous" });
      }
      if (links.length) await write(`INSERT INTO search_record_parcels
        (run_id, source_id, record_id, city_parcel_id, city_objectid,
         city_address_objectid, match_method, join_status)
        SELECT $1, 'school-attendance', x.record_id, x.city_parcel_id,
          x.city_objectid, x.address_id, 'nhps-range-city-address-point', x.join_status
        FROM jsonb_to_recordset($2::jsonb) AS x
          (record_id text, address_id bigint, city_parcel_id bigint,
           city_objectid bigint, join_status text)
        ON CONFLICT DO NOTHING`, [runId, JSON.stringify(links)]);
    }
    return await finishRun(runId, "school-attendance", rows.length);
  } catch (error) {
    await failRun(runId, error);
    throw error;
  }
}
