import { indexQuery } from "./db.js";
import { createHash } from "node:crypto";
import { arcgisInventory, arcgisFeatures } from "./arcgis.js";
import { INDEX_DATASETS } from "./catalog.js";
import { stateRosterInventory, stateRosterRows, STATE_ROSTERS } from "./socrata.js";
import { municipalPermitCatalogRows, municipalPermitTypeRows,
  sameMunicipalPermitRows, municipalDateSearchFormat, verifiedMunicipalPermitDays,
  municipalParcelRow, RECENT_PERMIT_WINDOWS } from "./municity.js";
import { isReviewedSubparcel, reviewedSubparcelEvidence } from "./subparcel-parents.js";
import { retainParcelPermits } from "./parcel-only-permits.js";
import { MUNICIPAL_LICENSE_SOURCE } from "./municipal-licenses.js";
import { recentCalendarDates } from "./ask.js";
import nhpsSnapshot from "../data/nhps-attendance.json" with { type: "json" };
import { municipalPermitTypes } from "../parcel/permit-types.js";
import { NHPS_ATTENDANCE_URL, normalizeSchoolStreet, schoolAddress,
  schoolRowsForAddress, snapshotIsCurrent } from "../parcel/school-attendance.js";
import { CHARITY_SOURCE } from "../parcel/charity-registrations.js";

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

export async function setRunInventory(runId, expectedCount, sourceUpdatedAt = null) {
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

const oneMunicipalParcelKey = `(SELECT count(DISTINCT nullif(trim(regexp_replace(
  upper(replace(r.fields->>key, '/', ' ')), '[[:space:]]+', ' ', 'g')), ''))
  FROM unnest(ARRAY['PrintKey', 'PrintKey_Parcel', 'VerifiedParentPrintKey']) AS keys(key)) <= 1`;

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
    WHERE r.run_id = $1 AND r.source_id = $4${sourceId === "municity" ? ` AND ${oneMunicipalParcelKey}` : ""}`,
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
      AND NULLIF(trim(p.fields->>'parcel_id'), '') IS NOT NULL
      AND ${oneMunicipalParcelKey}
      AND NOT EXISTS (SELECT 1 FROM search_record_parcels j
        WHERE j.run_id = r.run_id AND j.source_id = r.source_id AND j.record_id = r.record_id)`,
  [runId, Number(parcelRun[0].run_id), keyField,
    keyField === "PrintKey_Parcel" ? "published-permit-parent-key-exact" : "verified-municipal-parent-key-exact"]);
}

async function linkReviewedSubparcelParents(runId) {
  const runs = await write(`SELECT source_id, run_id FROM search_active_runs
    WHERE scope_key = 'all' AND source_id IN ('parcels', 'addresses')`);
  const active = Object.fromEntries(runs.map((row) => [row.source_id, row.run_id]));
  if (!active.parcels || !active.addresses) return;
  const mblu = (alias) => `trim(regexp_replace(upper(replace(${alias}.fields->>'mblu', '/', ' ')), '[[:space:]]+', ' ', 'g'))`;
  await write(`INSERT INTO search_record_parcels (run_id, source_id, record_id,
      city_parcel_id, city_objectid, city_address_objectid, match_method)
    SELECT r.run_id, r.source_id, r.record_id, points.parcel_id, points.objectid,
      points.address_id, 'municipal-explicit-subparcel-parent'
    FROM search_records r
    JOIN LATERAL (SELECT min(j.city_parcel_id) AS parcel_id, min(j.city_objectid) AS objectid,
        min(a.record_id::bigint) AS address_id
      FROM search_records a LEFT JOIN search_record_parcels j
        ON j.run_id = a.run_id AND j.source_id = a.source_id AND j.record_id = a.record_id
      WHERE a.run_id = $3 AND a.source_id = 'addresses'
        AND a.fields->>'normalized_address' = r.fields->'VerifiedSubparcelParent'->>'normalized_address'
      HAVING count(DISTINCT (j.city_parcel_id, j.city_objectid)) = 1
        AND bool_and(j.join_status IS NOT DISTINCT FROM 'exact')) points ON true
    JOIN search_records p ON p.run_id = $2 AND p.source_id = 'parcels'
      AND p.fields->>'parcel_id' = points.parcel_id::text AND p.record_id = points.objectid::text
      AND ${mblu("p")} = r.fields->'VerifiedSubparcelParent'->>'city_parent_mblu'
    WHERE r.run_id = $1 AND r.source_id = 'municity' AND r.fields ? 'VerifiedSubparcelParent'
      AND NOT EXISTS (SELECT 1 FROM search_records c WHERE c.run_id = p.run_id
        AND c.source_id = p.source_id AND c.record_id <> p.record_id AND ${mblu("c")} = ${mblu("p")})
      AND NOT EXISTS (SELECT 1 FROM search_record_parcels j
        WHERE j.run_id = r.run_id AND j.source_id = r.source_id AND j.record_id = r.record_id)`,
  [runId, active.parcels, active.addresses]);
}

async function linkStateAddresses(runId, sourceId) {
  const addressRun = await write(`SELECT run_id FROM search_active_runs
    WHERE source_id = 'addresses' AND scope_key = 'all'`);
  if (!addressRun.length) throw new Error("Complete City address baseline is required for State address joins");
  await write(`WITH matches AS (
    SELECT r.run_id, r.source_id, r.record_id, a.record_id AS address_id,
      ap.city_parcel_id, ap.city_objectid, ap.join_status
    FROM search_records r
    JOIN search_records a ON a.run_id = $2 AND a.source_id = 'addresses'
      AND a.fields->>'normalized_address' = r.fields->>'normalized_site_address'
    LEFT JOIN search_record_parcels ap ON ap.run_id = a.run_id
      AND ap.source_id = 'addresses' AND ap.record_id = a.record_id
    WHERE r.run_id = $1 AND r.source_id = $3
      AND length(r.fields->>'normalized_site_address') > 0
  ), flags AS (
    SELECT record_id, COUNT(DISTINCT (city_parcel_id, city_objectid)) AS parcel_count,
      bool_and(join_status IS NOT DISTINCT FROM 'exact') AS address_exact
    FROM matches GROUP BY record_id
  )
  INSERT INTO search_record_parcels (run_id, source_id, record_id,
    city_parcel_id, city_objectid, city_address_objectid, match_method, join_status)
  SELECT m.run_id, m.source_id, m.record_id, m.city_parcel_id,
    m.city_objectid, m.address_id::bigint, $4,
    CASE WHEN f.parcel_count = 1 AND f.address_exact THEN 'exact' ELSE 'ambiguous' END
  FROM matches m JOIN flags f ON f.record_id = m.record_id
  WHERE m.city_parcel_id IS NOT NULL`,
  [runId, Number(addressRun[0].run_id), sourceId,
    sourceId === CHARITY_SOURCE ? "state-registered-address-city-address-point" : "state-site-city-address-point"]);
}

export async function finishRun(runId, sourceId, expectedCount,
  { sourceWarning = null, partial = false, metadata = {}, licenseChecks = null, previousRunId = null } = {}) {
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
    await linkReviewedSubparcelParents(runId);
  }
  else if (["school-attendance", "municity-permit-types", "municity-permit-activity", MUNICIPAL_LICENSE_SOURCE].includes(sourceId)) {
    /* These imports supply their own parcel links when applicable. */
  }
  else if (STATE_ROSTERS[sourceId]) await linkStateAddresses(runId, sourceId);
  else if (sourceId === "trash-pickup") await linkSpatial(runId, sourceId, { addressZone: true });
  else if (!["metered-parking-spaces", "transit-stops"].includes(sourceId))
    await linkSpatial(runId, sourceId);
  const statistics = await write(`SELECT COUNT(*)::integer AS linked,
    COUNT(*) FILTER (WHERE join_status = 'ambiguous')::integer AS ambiguous
    FROM search_record_parcels WHERE run_id = $1`, [runId]);
  const retained = sourceId === "municity" ? await retainParcelPermits(runId) : null;
  const linked = Number(retained?.linked ?? statistics[0].linked);
  const ambiguous = Number(retained?.ambiguous ?? statistics[0].ambiguous);
  const distinctLinked = Number((await write(`SELECT COUNT(DISTINCT record_id)::integer AS n
    FROM search_record_parcels WHERE run_id = $1`, [runId]))[0].n);
  const unlinked = retained ? Number(retained.unlinked)
    : ["metered-parking-spaces", "transit-stops", "municity-permit-types"].includes(sourceId)
      ? 0 : Math.max(0, returned - distinctLinked);
  const warning = [sourceId === "parcels" && unlinked > 0
    ? `${unlinked} official City parcel features lack a published parcel ID`
    : null, sourceWarning].filter(Boolean).join("; ") || null;
  const checkpoint = licenseChecks ? `, saved AS (
    INSERT INTO search_city_license_checks
      (city_objectid, city_parcel_id, mblu, outcome, last_checked_at, next_check_at)
    SELECT c.city_objectid, c.city_parcel_id, c.mblu, c.outcome, c.last_checked_at, c.next_check_at
    FROM activated CROSS JOIN jsonb_to_recordset($10::jsonb) AS c(
      city_objectid bigint, city_parcel_id bigint, mblu text, outcome text,
      last_checked_at timestamptz, next_check_at timestamptz)
    ON CONFLICT (city_objectid) DO UPDATE SET city_parcel_id = EXCLUDED.city_parcel_id,
      mblu = EXCLUDED.mblu, outcome = EXCLUDED.outcome,
      last_checked_at = EXCLUDED.last_checked_at, next_check_at = EXCLUDED.next_check_at
  )` : "";
  const activated = await write(`WITH finished AS (
    UPDATE search_source_runs SET status = $7, finished_at = now(),
      returned_count = $2, linked_count = $3, ambiguous_count = $4,
      unlinked_count = $5, warning = $6, metadata = metadata || $8::jsonb
    WHERE id = $1 AND status = 'running'${licenseChecks ? `
      AND (SELECT run_id FROM search_active_runs a WHERE a.source_id = search_source_runs.source_id
        AND a.scope_key = search_source_runs.scope_key) IS NOT DISTINCT FROM $9::bigint` : ""}
    RETURNING id, source_id, scope_key
  ), activated AS (
    INSERT INTO search_active_runs (source_id, scope_key, run_id)
    SELECT source_id, scope_key, id FROM finished
    ON CONFLICT (source_id, scope_key) DO UPDATE SET run_id = EXCLUDED.run_id
      ${licenseChecks ? "WHERE search_active_runs.run_id = $9::bigint" : ""}
    RETURNING run_id
  )${checkpoint} SELECT run_id FROM activated`,
  [runId, returned, linked, ambiguous, unlinked, warning, partial ? "partial" : "complete",
    JSON.stringify(metadata), ...(licenseChecks ? [previousRunId, JSON.stringify(licenseChecks)] : [])]);
  if (licenseChecks && !activated.length)
    throw new Error("The City license index changed while this batch was running; its checkpoints were not applied");
  return { run_id: runId, returned, linked, ambiguous, unlinked };
}

export async function failRun(runId, error) {
  const reason = String(error?.message ?? error);
  const warning = ["MUNICIPAL_TYPE_CAP", "MUNICIPAL_LICENSE_UNVERIFIED"].includes(error?.code)
    ? `${error.code}: ${reason}` : reason;
  await write(`UPDATE search_source_runs SET status = 'failed', finished_at = now(),
    warning = $2 WHERE id = $1 AND status = 'running'`,
  [runId, warning.slice(0, 500)]);
}

export async function importArcgisSource(sourceId) {
  const definition = INDEX_DATASETS[sourceId];
  if (definition?.kind !== "arcgis")
    throw new Error("Unknown GIS index source");
  // An unchanged publisher revision and exact ID set can reuse the active
  // layer. Spatial links also depend on the current City baseline; a newer
  // parcel or address run requires the layer to be linked again.
  const inventory = await arcgisInventory(sourceId);
  const current = await write(`SELECT r.id, r.expected_count, r.source_updated_at,
      r.started_at,
      (SELECT max(p.started_at) FROM search_active_runs a
        JOIN search_source_runs p ON p.id = a.run_id
        WHERE a.source_id = 'parcels' AND a.scope_key = 'all') AS parcel_started_at,
      (SELECT max(p.started_at) FROM search_active_runs a
        JOIN search_source_runs p ON p.id = a.run_id
        WHERE a.source_id = 'addresses' AND a.scope_key = 'all') AS address_started_at
    FROM search_active_runs a JOIN search_source_runs r ON r.id = a.run_id
    WHERE a.source_id = $1 AND a.scope_key = 'all' AND r.status = 'complete'`,
  [sourceId]);
  const prior = current[0];
  const parcelDependency = !["parcels", "metered-parking-spaces", "transit-stops"].includes(sourceId);
  const addressDependency = sourceId === "trash-pickup";
  const dependencyCurrent = (!parcelDependency || (prior?.parcel_started_at &&
    new Date(prior.started_at) >= new Date(prior.parcel_started_at))) &&
    (!addressDependency || (prior?.address_started_at &&
      new Date(prior.started_at) >= new Date(prior.address_started_at)));
  if (prior && dependencyCurrent &&
      Number(prior.expected_count) === inventory.source_count &&
      new Date(prior.source_updated_at).toISOString() === inventory.source_updated_at) {
    const [stored] = await write(`SELECT count(*)::integer AS count,
      md5(string_agg(record_id, ',' ORDER BY record_id::bigint)) AS id_hash
      FROM search_records WHERE run_id = $1 AND source_id = $2`,
    [prior.id, sourceId]);
    const listedHash = createHash("md5").update(inventory.object_ids.join(",")).digest("hex");
    if (Number(stored?.count) === inventory.source_count && stored?.id_hash === listedHash) {
      const confirmed = await arcgisInventory(sourceId);
      if (confirmed.source_updated_at === inventory.source_updated_at &&
          confirmed.source_count === inventory.source_count &&
          confirmed.object_ids.every((id, index) => id === inventory.object_ids[index]))
        return { run_id: Number(prior.id), returned: inventory.source_count,
          linked: null, ambiguous: null, unlinked: null, reused: true };
    }
  }
  const runId = await beginRun(sourceId);
  try {
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
    const catalog = () => municipalPermitTypes({ retry429: true });
    const first = await municipalPermitTypeRows(type, { catalog });
    await setRunInventory(runId, first.rows.length);
    for (let offset = 0; offset < first.rows.length; offset += 200)
      await insertRecords(runId, "municity", first.rows.slice(offset, offset + 200));
    const final = await municipalPermitTypeRows(permitType, { catalog });
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

// These windows share one source scan. The older slice extends the validated
// 30-day run without fetching the most recent dates a third time.
export async function importMunicipalPermitWindows({ now = new Date() } = {}) {
  const [shortWindow, longWindow] = RECENT_PERMIT_WINDOWS;
  const recent = recentCalendarDates(shortWindow.days, now);
  const extended = recentCalendarDates(longWindow.days, now);
  const older = { from: extended.from,
    to: new Date(Date.parse(recent.from) - 86_400_000).toISOString().slice(0, 10) };
  const parents = new Map();

  const shortRun = await beginRun("municity", shortWindow.scope_key, null, null, recent);
  let format, short, shortResult;
  try {
    format = await municipalDateSearchFormat();
    short = await verifiedMunicipalPermitDays(recent, format);
    await addVerifiedPermitParents(short.rows, parents);
    shortResult = await publishPermitWindow(shortRun, shortWindow.scope_key, recent, short);
  } catch (error) {
    await failRun(shortRun, error);
    throw error;
  }

  const errors = [];
  await refreshElectricalProjections(recent, short.rows, errors);
  const longRun = await beginRun("municity", longWindow.scope_key, null, null, extended);
  let longResult;
  try {
    const earlier = await verifiedMunicipalPermitDays(older, format);
    const ids = new Set(short.rows.map((row) => row.record_id));
    if (earlier.rows.some((row) => ids.has(row.record_id)))
      throw new Error(`A permit appeared on both sides of the ${recent.from} date boundary`);
    await addVerifiedPermitParents(earlier.rows, parents);
    longResult = await publishPermitWindow(longRun, longWindow.scope_key, extended, {
      rows: [...earlier.rows, ...short.rows],
      sourceCount: earlier.sourceCount + short.sourceCount,
      datesChecked: earlier.datesChecked + short.datesChecked,
    });
  } catch (error) {
    await failRun(longRun, error);
    errors.push(`${longWindow.scope_key}: ${error.message}`);
  }
  if (errors.length) throw new Error(errors.join("; "));
  return { recent: shortResult, extended: longResult };
}

async function addVerifiedPermitParents(rows, cache) {
  for (const row of rows) {
    const { PrintKey, PrintKey_Parcel, Parcel_ID } = row.fields;
    if (!Parcel_ID || ((PrintKey || PrintKey_Parcel) && !isReviewedSubparcel(Parcel_ID))) continue;
    const id = String(Parcel_ID);
    if (!cache.has(id)) {
      try { cache.set(id, await municipalParcelRow(id)); }
      catch { cache.set(id, null); }
    }
    const official = cache.get(id);
    if (!PrintKey && !PrintKey_Parcel && official?.PrintKey)
      row.fields.VerifiedParentPrintKey = official.PrintKey;
    const parent = reviewedSubparcelEvidence(row.fields, official);
    if (parent) row.fields.VerifiedSubparcelParent = parent;
  }
}

async function publishPermitWindow(runId, scopeKey, range, { rows, sourceCount, datesChecked }) {
  await setRunInventory(runId, rows.length);
  for (let offset = 0; offset < rows.length; offset += 200)
    await insertRecords(runId, "municity", rows.slice(offset, offset + 200));
  const sourceWarning = sourceCount > rows.length
    ? `${sourceCount} published rows reconciled to ${rows.length} distinct permit IDs across ${datesChecked} verified dates`
    : null;
  const counts = await finishRun(runId, "municity", rows.length, { sourceWarning });
  const summary = { scope_key: scopeKey, coverage_date_from: range.from,
    coverage_date_to: range.to, dates_checked: datesChecked, vendor_rows: sourceCount,
    observed_types: new Set(rows.map((row) => row.published_type)).size, ...counts };
  console.log(JSON.stringify({ event: "municipal_permit_window", ...summary }));
  return summary;
}

async function refreshElectricalProjections(range, rows, errors) {
  const projections = [
    ["permit-type:ELECTRICAL PERMIT", async () => ["ELECTRICAL PERMIT"]],
    ["permit-group:ELECTRICAL", async () => {
      const listed = await municipalPermitTypes({ fresh: true, retry429: true });
      municipalPermitCatalogRows(listed);
      const group = listed.groups.find((entry) => entry.name === "Electrical");
      if (!group?.types.length) throw new Error("Official Electrical group is absent");
      return group.types.map((entry) => entry.name.trim().toUpperCase());
    }],
  ];
  for (const [scopeKey, typeNames] of projections) {
    const runId = await beginRun("municity", scopeKey, null, null, range);
    try {
      const names = new Set(await typeNames());
      const subset = rows.filter((row) => names.has(row.published_type.trim().toUpperCase()));
      await publishPermitWindow(runId, scopeKey, range, { rows: subset, sourceCount: subset.length,
        datesChecked: 30 });
    } catch (error) {
      await failRun(runId, error);
      errors.push(`${scopeKey}: ${error.message}`);
    }
  }
}

export async function importMunicipalPermitCatalog() {
  const runId = await beginRun("municity-permit-types");
  try {
    const listed = await municipalPermitTypes({ fresh: true, retry429: true });
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
