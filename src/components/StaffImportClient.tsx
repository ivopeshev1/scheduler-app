"use client";

/**
 * Bulk-staff-import preview + commit widget. Lives entirely client-
 * side after the file is picked: we parse CSV/XLSX in the browser,
 * build a preview table, let the manager eyeball the result, and only
 * then submit the normalized JSON payload to importStaffAction.
 *
 * We do validation in the browser (missing fields, bad rate numbers,
 * duplicates-with-each-other, duplicates-with-existing-staff, unknown
 * locations) so the manager fixes mistakes in-place and the server
 * side stays a single straight-line insert. The server does its own
 * guardrails too - this preview is UX, not security.
 */

import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";

type RawRow = Record<string, string>;

type NormalizedRow = {
  firstName: string;
  lastName: string;
  email: string;
  primaryRole: string;
  rate: number;
  rateType: "hourly" | "flat";
  // UI / validation
  errors: string[];
  warnings: string[];
};

/**
 * Canonical field name → every spelling we've seen a staffing /
 * scheduling / HR tool export for it. Match is case-insensitive and
 * ignores whitespace and punctuation (see normalizeHeaderKey). Extra
 * columns in the uploaded file that don't match any alias are silently
 * ignored - users don't have to strip them.
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  first_name: ["first_name", "firstname", "first", "given_name", "forename", "given"],
  last_name: ["last_name", "lastname", "last", "surname", "family_name", "family"],
  // When the source file has a single combined column, we split it in
  // normalize() and flag the row with a warning so the manager can
  // eyeball the split before committing.
  full_name: ["full_name", "name", "staff_name", "employee_name", "contact_name", "display_name"],
  email: ["email", "email_address", "e_mail", "mail", "work_email", "contact_email"],
  primary_role: ["primary_role", "role", "position", "job", "primary_job", "job_title", "title", "default_role"],
  rate: ["rate", "pay_rate", "hourly_rate", "flat_rate", "wage", "pay", "default_rate"],
  rate_type: ["rate_type", "pay_type", "rate_kind", "wage_type", "default_rate_type"],
};

const REQUIRED = ["first_name", "last_name", "email", "primary_role", "rate", "rate_type"] as const;

/**
 * Collapse "First Name", "first-name", "firstName", "e-mail" etc. to a
 * single canonical shape ("first_name", "e_mail") so the alias map can
 * match without listing every punctuation variant.
 */
function normalizeHeaderKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/**
 * Walk the alias table against the raw-row keys and produce a new row
 * keyed by our canonical names, plus the source-header name that each
 * canonical field came from. Keeping the source header around lets
 * downstream code infer intent from the column name itself - e.g. a
 * cell under "Hourly Rate" implies rate_type=hourly even when there's
 * no separate rate_type column. Multiple source columns mapping to the
 * same canonical field: first non-empty wins.
 */
function remapRow(raw: RawRow): { fields: RawRow; sourceHeaders: Record<string, string> } {
  const normalized: RawRow = {};
  const sources: Record<string, string> = {};
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    const aliasSet = new Set(aliases.map(normalizeHeaderKey));
    for (const [k, v] of Object.entries(raw)) {
      if (!aliasSet.has(normalizeHeaderKey(k))) continue;
      const trimmed = String(v ?? "").trim();
      if (!normalized[canonical] && trimmed) {
        normalized[canonical] = trimmed;
        sources[canonical] = k;
      }
    }
  }
  return { fields: normalized, sourceHeaders: sources };
}

/**
 * Pull a rate number and (optionally) a rate type out of a single cell.
 * Handles the real-world shapes exporters produce:
 *   "30"                  -> { amount: 30, type: null }
 *   "$30"                 -> { amount: 30, type: null }
 *   "30/hr" / "30/hour"   -> { amount: 30, type: "hourly" }
 *   "$30/hr"              -> { amount: 30, type: "hourly" }
 *   "30 hourly"           -> { amount: 30, type: "hourly" }
 *   "600 flat"            -> { amount: 600, type: "flat" }
 *   "$600/event"          -> { amount: 600, type: "flat" }
 *   "$1,250.00 per event" -> { amount: 1250, type: "flat" }
 * Returns null amount when no digits are present.
 */
function parseRateCell(raw: string): { amount: number | null; type: "hourly" | "flat" | null } {
  const lower = raw.toLowerCase();
  const digits = lower.replace(/[^0-9.]/g, "");
  const amount = digits ? Number(digits) : null;
  const normalizedForType = lower.replace(/[^a-z/]/g, "");
  let type: "hourly" | "flat" | null = null;
  if (/hour|\/hr|\/h\b|hourly|perhour/.test(normalizedForType)) type = "hourly";
  else if (/flat|event|gig|job|persession|pershift|perevent/.test(normalizedForType)) type = "flat";
  return { amount: Number.isFinite(amount) ? amount : null, type };
}

/**
 * Infer rate_type from the source column's header name when the cell
 * itself didn't carry a hint. "Hourly Rate" column -> hourly,
 * "Flat Rate" / "Event Rate" column -> flat, generic "Rate"/"Pay"
 * column -> null (caller falls back to hourly as the safer default).
 */
function inferTypeFromHeader(header: string | undefined): "hourly" | "flat" | null {
  if (!header) return null;
  const h = header.toLowerCase();
  if (/hour|hourly/.test(h)) return "hourly";
  if (/flat|event|gig|job|session|shift/.test(h)) return "flat";
  return null;
}

function normalize(
  row: RawRow,
  sourceHeaders: Record<string, string>,
  ctx: { existingEmails: string[]; seenEmails: Set<string> },
): NormalizedRow {
  const get = (k: string) => (row[k] ?? "").toString().trim();
  const errors: string[] = [];
  const warnings: string[] = [];

  // Name: prefer explicit first_name/last_name columns, but if the
  // source file only had a combined "Full Name"/"Name" column, split
  // it on the first space (Jamie Rivera -> first=Jamie, last=Rivera;
  // Mary Jane Watson -> first=Mary, last=Jane Watson) and flag the
  // row so the manager can eyeball every row that was auto-split.
  // Compound surnames like "Van Der Berg" or "Watson-Smith" survive
  // the simple split; harder cases (Chinese names in Western order,
  // single-word names) get fixed in-source and re-uploaded.
  let firstName = get("first_name");
  let lastName = get("last_name");
  if ((!firstName || !lastName) && get("full_name")) {
    const parts = get("full_name").split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      firstName = firstName || parts[0];
      lastName = lastName || parts[0];
      warnings.push(`Only one word in name "${get("full_name")}" - using it for both first and last`);
    } else if (parts.length >= 2) {
      if (!firstName) firstName = parts[0];
      if (!lastName) lastName = parts.slice(1).join(" ");
      warnings.push(`Split "${get("full_name")}" into "${firstName}" / "${lastName}" - review before committing`);
    }
  }
  if (!firstName) errors.push("Missing first_name");
  if (!lastName) errors.push("Missing last_name");

  // The remaining required pieces. rate and rate_type are handled
  // jointly below so a single "$30/hr" cell counts as both.
  if (!get("email")) errors.push("Missing email");
  if (!get("primary_role")) errors.push("Missing primary_role");

  const email = get("email").toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Invalid email format");
  if (email && ctx.existingEmails.includes(email)) errors.push("Email already exists in your staff");
  if (email && ctx.seenEmails.has(email)) errors.push("Duplicate email in this file");
  if (email) ctx.seenEmails.add(email);

  // Layered rate parsing. Priority:
  //   1. If the rate cell has units baked in ("$30/hr", "600 flat") we
  //      use those for both the amount and the type.
  //   2. Otherwise the amount comes from rate and the type comes from
  //      a separate rate_type cell.
  //   3. If rate_type is still missing, try to infer from the rate
  //      column's own header ("Hourly Rate" column -> hourly).
  //   4. Fallback: hourly, with a warning so the manager can double-
  //      check in the preview before committing.
  const rateRaw = get("rate");
  const { amount: parsedAmount, type: parsedTypeFromCell } = parseRateCell(rateRaw);
  if (rateRaw && parsedAmount === null) {
    errors.push(`Couldn't read a number out of rate "${rateRaw}"`);
  }
  if (rateRaw && parsedAmount !== null && parsedAmount < 0) {
    errors.push("Rate must be non-negative");
  }
  if (!rateRaw) errors.push("Missing rate");

  const rateTypeRaw = get("rate_type").toLowerCase();
  let rateType: "hourly" | "flat" = "hourly";
  let typeSource: "cell" | "rate_type_cell" | "header" | "default" = "default";
  if (parsedTypeFromCell) {
    rateType = parsedTypeFromCell;
    typeSource = "cell";
  } else if (rateTypeRaw) {
    if (/^(flat|f|per_event|per_shift|per_gig|event|gig)$/.test(rateTypeRaw)) {
      rateType = "flat";
      typeSource = "rate_type_cell";
    } else if (/^(hourly|h|per_hour|hour)$/.test(rateTypeRaw)) {
      rateType = "hourly";
      typeSource = "rate_type_cell";
    } else {
      warnings.push(`rate_type "${rateTypeRaw}" unrecognized, defaulting to hourly`);
    }
  } else {
    const fromHeader = inferTypeFromHeader(sourceHeaders.rate);
    if (fromHeader) {
      rateType = fromHeader;
      typeSource = "header";
    }
  }
  if (typeSource === "default" && rateRaw) {
    warnings.push("rate_type not specified, defaulting to hourly");
  }

  return {
    firstName,
    lastName,
    email,
    primaryRole: get("primary_role"),
    rate: parsedAmount ?? 0,
    rateType,
    errors,
    warnings,
  };
}

export function StaffImportClient({
  formAction,
  knownRoleNames,
  existingEmails,
}: {
  formAction: (formData: FormData) => Promise<void> | void;
  knownRoleNames: string[];
  existingEmails: string[];
}) {
  const [remappedRows, setRemappedRows] = useState<
    { fields: RawRow; sourceHeaders: Record<string, string> }[]
  >([]);
  const [fileName, setFileName] = useState<string>("");
  const [parseError, setParseError] = useState<string>("");
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
  const [ignoredHeaders, setIgnoredHeaders] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function finalizeRows(parsedRaw: Record<string, unknown>[]) {
    const nonEmpty = parsedRaw.filter((r) =>
      Object.values(r).some((v) => String(v ?? "").trim() !== ""),
    );
    const headers = nonEmpty.length > 0 ? Object.keys(nonEmpty[0]) : [];
    setDetectedHeaders(headers);
    const canonicalKnown = new Set(
      Object.values(COLUMN_ALIASES).flat().map(normalizeHeaderKey),
    );
    setIgnoredHeaders(headers.filter((h) => !canonicalKnown.has(normalizeHeaderKey(h))));
    setRemappedRows(
      nonEmpty.map((r) => {
        const asStrings: RawRow = {};
        for (const [k, v] of Object.entries(r)) asStrings[k] = String(v ?? "");
        return remapRow(asStrings);
      }),
    );
  }

  function handleFile(file: File) {
    setParseError("");
    setFileName(file.name);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "csv" || file.type === "text/csv") {
      Papa.parse<Record<string, unknown>>(file, {
        header: true,
        skipEmptyLines: true,
        // Keep headers as-written so the aliases table can match against
        // real-world spellings like "Email Address" or "Mobile Number"
        // without pre-normalizing them to lose that information.
        complete: (result) => {
          if (result.errors.length > 0) {
            setParseError(result.errors.map((e) => e.message).join("; "));
          }
          finalizeRows(result.data);
        },
        error: (err) => setParseError(err.message),
      });
    } else if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
          finalizeRows(json);
        } catch (err) {
          setParseError(err instanceof Error ? err.message : String(err));
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      setParseError("Unsupported file type. Use .csv, .xlsx, or .xls.");
    }
  }

  const normalized = useMemo<NormalizedRow[]>(() => {
    const seen = new Set<string>();
    return remappedRows.map((r) =>
      normalize(r.fields, r.sourceHeaders, { existingEmails, seenEmails: seen }),
    );
  }, [remappedRows, existingEmails]);

  const ok = normalized.filter((r) => r.errors.length === 0);
  const bad = normalized.filter((r) => r.errors.length > 0);
  const withWarnings = normalized.filter((r) => r.warnings.length > 0);
  const newRoles = useMemo(() => {
    const known = new Set(knownRoleNames.map((n) => n.toLowerCase()));
    const seen = new Set<string>();
    for (const r of ok) {
      if (r.primaryRole && !known.has(r.primaryRole.toLowerCase())) seen.add(r.primaryRole);
    }
    return Array.from(seen);
  }, [ok, knownRoleNames]);

  return (
    <section className="border rounded-lg bg-white p-6">
      <h2 className="text-sm font-semibold mb-2">2. Upload your file</h2>
      <p className="text-sm text-gray-600 mb-3">
        CSV or Excel. Headers can be in any order, but names must match the template.
      </p>
      <div className="flex items-center gap-3 mb-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
          className="text-sm"
        />
        {fileName && <span className="text-xs text-gray-500">{fileName}</span>}
        {remappedRows.length > 0 && (
          <button
            type="button"
            className="text-xs text-red-600 hover:underline"
            onClick={() => {
              setRemappedRows([]);
              setFileName("");
              setParseError("");
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          >
            Clear
          </button>
        )}
      </div>
      {parseError && (
        <div className="mb-4 border border-red-300 bg-red-50 text-red-800 text-sm rounded p-3">
          Parse error: {parseError}
        </div>
      )}
      {detectedHeaders.length > 0 && (
        <div className="mb-4 text-xs text-gray-600 border rounded p-3 bg-gray-50">
          <p>
            <span className="font-semibold">Detected columns:</span>{" "}
            {detectedHeaders.join(", ")}
          </p>
          {ignoredHeaders.length > 0 && (
            <p className="mt-1 text-gray-500">
              Ignored columns (we don&apos;t need these — staffers fill them in during onboarding):{" "}
              {ignoredHeaders.join(", ")}
            </p>
          )}
        </div>
      )}

      {normalized.length > 0 && (
        <>
          <h3 className="text-sm font-semibold mt-6 mb-2">
            3. Preview — {normalized.length} row{normalized.length === 1 ? "" : "s"}
          </h3>
          <div className="flex gap-4 text-xs mb-3">
            <span className="text-green-700">✓ Ready: {ok.length}</span>
            {bad.length > 0 && <span className="text-red-700">✗ Errors: {bad.length}</span>}
            {withWarnings.length > 0 && (
              <span className="text-amber-700">! Warnings: {withWarnings.length}</span>
            )}
            {newRoles.length > 0 && (
              <span className="text-blue-700">
                + {newRoles.length} new role{newRoles.length === 1 ? "" : "s"} will be added: {newRoles.join(", ")}
              </span>
            )}
          </div>

          <div className="border rounded overflow-auto max-h-[480px]">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left p-2">#</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Name</th>
                  <th className="text-left p-2">Email</th>
                  <th className="text-left p-2">Primary role / rate</th>
                  <th className="text-left p-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {normalized.map((r, i) => {
                  const status = r.errors.length > 0 ? "error" : r.warnings.length > 0 ? "warn" : "ok";
                  const bg =
                    status === "error" ? "bg-red-50" : status === "warn" ? "bg-amber-50" : "bg-white";
                  return (
                    <tr key={i} className={`border-t ${bg}`}>
                      <td className="p-2 text-gray-500">{i + 1}</td>
                      <td className="p-2">
                        {status === "error" ? "✗" : status === "warn" ? "!" : "✓"}
                      </td>
                      <td className="p-2">{r.firstName} {r.lastName}</td>
                      <td className="p-2 font-mono">{r.email}</td>
                      <td className="p-2">
                        {r.primaryRole} · ${r.rate} {r.rateType}
                      </td>
                      <td className="p-2">
                        {r.errors.map((e, j) => <div key={`e${j}`} className="text-red-700">{e}</div>)}
                        {r.warnings.map((w, j) => <div key={`w${j}`} className="text-amber-700">{w}</div>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {ok.length > 0 && (
            <form action={formAction} className="mt-5 space-y-3">
              <input
                type="hidden"
                name="rows"
                value={JSON.stringify(
                  ok.map(({ errors, warnings, ...keep }) => {
                    void errors;
                    void warnings;
                    return keep;
                  }),
                )}
              />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="sendInvitesNow" />
                Send invite emails to everyone imported right after commit
              </label>
              <button type="submit" className="btn btn-primary">
                Import {ok.length} staff member{ok.length === 1 ? "" : "s"}
                {bad.length > 0 && ` (skipping ${bad.length} errored)`}
              </button>
              <p className="text-xs text-gray-500">
                You can leave the invite box unchecked and send invites later from the Staff page
                after you&apos;ve double-checked the imported rows.
              </p>
            </form>
          )}
        </>
      )}
    </section>
  );
}
