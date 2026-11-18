import { load } from "cheerio";
import { fetchBounded } from "../../parcel/http.js";

const allowed = new Map([
  [11236, "20 Eld St"],
  [10386, "990 State St"],
  [13791, "181 Crown St"],
  [24641, "869 Whalley Ave"],
]);

export default {
  async fetch(request) {
    if (process.env.VERCEL_ENV !== "preview" || request.method !== "GET")
      return new Response("Not found", { status: 404 });
    const pid = Number(new URL(request.url).searchParams.get("pid"));
    if (!allowed.has(pid)) return new Response("Not found", { status: 404 });
    const url = `https://gis.vgsi.com/newhavenct/Parcel.aspx?pid=${pid}`;
    const html = await fetchBounded(url, { accept: "text/html,application/xhtml+xml", timeout: 12000, maxBytes: 5_000_000 })
      .catch((error) => `SOURCE_ERROR: ${error.message}`);
    if (html.startsWith("SOURCE_ERROR:")) return Response.json({ pid, error: html });
    const $ = load(html);
    const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
    const fields = [];
    $('[id^="MainContent_"]').each((_, element) => {
      const id = $(element).attr("id");
      if (!id || $(element).find('[id^="MainContent_"]').length) return;
      const value = clean($(element).text());
      if (value) fields.push({ id, tag: element.tagName, value });
    });
    const tables = $("table").toArray().map((element) => {
      const rows = $(element).find("tr").toArray().filter((row) => $(row).closest("table")[0] === element);
      return {
        id: $(element).attr("id") ?? null,
        headings: rows.slice(0, 2).map((row) => $(row).children("th,td").toArray().map((cell) => clean($(cell).text()))),
        row_count: rows.length,
      };
    }).filter((table) => table.id?.startsWith("MainContent_") || table.row_count > 3);
    const ownerRow = $("#MainContent_lblLabelCoOwner").closest("tr");
    const selectedRows = Object.fromEntries(["MainContent_ctl02_grdCns", "MainContent_grdXf", "MainContent_grdOb"]
      .map((id) => [id, $(`#${id}`).find("tr").toArray().slice(0, 60)
        .map((row) => $(row).children("th,td").toArray().map((cell) => clean($(cell).text())))]));
    return Response.json({ pid, address: allowed.get(pid), verified_pid: clean($("#MainContent_lblPid").text()),
      field_count: fields.length, fields: fields.slice(0, 500), tables: tables.slice(0, 100),
      co_owner_row_html: $.html(ownerRow).slice(0, 3000), selected_rows: selectedRows },
      { headers: { "Cache-Control": "private, no-store" } });
  },
};
