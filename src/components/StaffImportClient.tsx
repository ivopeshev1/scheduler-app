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
  phone: string | null;
  city: string | null;
  primaryRole: string;
  rate: number;
  rateType: "hourly" | "flat";
  additionalRoles: { role: string; rate: number; rateType: "hourly" | "flat" }[];
  locations: string[];
  canDriveVan: boolean;
  // UI / validation
  errors: string[];
  warnings: string[];
};

const REQUIRED = ["first_name", "last_name", "email", "primary_role", "rate", "rate_type"] as const;

/**
 * Normalize US-looking phone into +1XXXXXXXXXX. Non-US phones (10+
 * digits with an explicit country code) pass through with punctuation
 * stripped. Returns null for anything we can't match - caller treats
 * null as "no phone on file" rather than erroring.
 */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 10) return `+${digits}`;
  return null;
}

function parseBool(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === "yes" || v === "y" || v === "true" || v === "1";
}

function parseAdditionalRoles(
  raw: string,
): { role: string; rate: number; rateType: "hourly" | "flat" }[] {
  if (!raw.trim()) return [];
  return raw
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      // Format: Role:rate:type - e.g. "Bartender:30:hourly"
      const parts = chunk.split(":").map((s) => s.trim());
      if (parts.length < 3) return null;
      const [role, rateStr, type] = parts;
      const rate = Number(rateStr);
      if (!role || !Number.isFinite(rate) || rate < 0) return null;
      const rateType = type.toLowerCase() === "flat" ? "flat" : "hourly";
      return { role, rate, rateType: rateType as "hourly" | "flat" };
    })
    .filter((r): r is { role: string; rate: number; rateType: "hourly" | "flat" } => r !== null);
}

function parseLocations(raw: string): string[] {
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalize(
  row: RawRow,
  ctx: { knownLocationNames: string[]; existingEmails: string[]; seenEmails: Set<string> },
): NormalizedRow {
  const get = (k: string) => (row[k] ?? "").toString().trim();
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const k of REQUIRED) {
    if (!get(k)) errors.push(`Missing ${k}`);
  }

  const email = get("email").toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Invalid email format");
  if (email && ctx.existingEmails.includes(email)) errors.push("Email already exists in your staff");
  if (email && ctx.seenEmails.has(email)) errors.push("Duplicate email in this file");
  if (email) ctx.seenEmails.add(email);

  const rate = Number(get("rate"));
  if (get("rate") && (!Number.isFinite(rate) || rate < 0)) errors.push("Invalid rate (must be a non-negative number)");

  const rateTypeRaw = get("rate_type").toLowerCase();
  const rateType: "hourly" | "flat" = rateTypeRaw === "flat" ? "flat" : "hourly";
  if (get("rate_type") && rateTypeRaw !== "hourly" && rateTypeRaw !== "flat") {
    errors.push(`rate_type must be "hourly" or "flat" (got "${rateTypeRaw}")`);
  }

  const phoneRaw = get("phone");
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && !phone) warnings.push(`Phone "${phoneRaw}" couldn't be normalized, leaving blank`);

  const locations = parseLocations(get("locations"));
  const knownLower = new Set(ctx.knownLocationNames.map((s) => s.toLowerCase()));
  const unknownLocs = locations.filter((l) => !knownLower.has(l.toLowerCase()));
  if (unknownLocs.length > 0) errors.push(`Unknown location(s): ${unknownLocs.join(", ")}`);

  const additionalRoles = parseAdditionalRoles(get("additional_roles"));

  return {
    firstName: get("first_name"),
    lastName: get("last_name"),
    email,
    phone,
    city: get("city") || null,
    primaryRole: get("primary_role"),
    rate: Number.isFinite(rate) ? rate : 0,
    rateType,
    additionalRoles,
    locations,
    canDriveVan: parseBool(get("can_drive_van")),
    errors,
    warnings,
  };
}

export function StaffImportClient({
  formAction,
  knownRoleNames,
  knownLocationNames,
  existingEmails,
}: {
  formAction: (formData: FormData) => Promise<void> | void;
  knownRoleNames: string[];
  knownLocationNames: string[];
  existingEmails: string[];
}) {
  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [parseError, setParseError] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    setParseError("");
    setFileName(file.name);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "csv" || file.type === "text/csv") {
      Papa.parse<RawRow>(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
        complete: (result) => {
          if (result.errors.length > 0) {
            setParseError(result.errors.map((e) => e.message).join("; "));
          }
          setRawRows(result.data.filter((r) => Object.values(r).some((v) => String(v ?? "").trim() !== "")));
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
          // Normalize header case the same way the CSV path does.
          const normalized: RawRow[] = json.map((row) => {
            const out: RawRow = {};
            for (const [k, v] of Object.entries(row)) {
              out[k.trim().toLowerCase().replace(/\s+/g, "_")] = String(v ?? "").trim();
            }
            return out;
          }).filter((r) => Object.values(r).some((v) => String(v ?? "").trim() !== ""));
          setRawRows(normalized);
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
    return rawRows.map((r) =>
      normalize(r, { knownLocationNames, existingEmails, seenEmails: seen }),
    );
  }, [rawRows, knownLocationNames, existingEmails]);

  const ok = normalized.filter((r) => r.errors.length === 0);
  const bad = normalized.filter((r) => r.errors.length > 0);
  const withWarnings = normalized.filter((r) => r.warnings.length > 0);
  const newRoles = useMemo(() => {
    const known = new Set(knownRoleNames.map((n) => n.toLowerCase()));
    const seen = new Set<string>();
    for (const r of ok) {
      if (!known.has(r.primaryRole.toLowerCase())) seen.add(r.primaryRole);
      for (const ar of r.additionalRoles) {
        if (!known.has(ar.role.toLowerCase())) seen.add(ar.role);
      }
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
        {rawRows.length > 0 && (
          <button
            type="button"
            className="text-xs text-red-600 hover:underline"
            onClick={() => {
              setRawRows([]);
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
                  <th className="text-left p-2">Phone</th>
                  <th className="text-left p-2">Primary role / rate</th>
                  <th className="text-left p-2">Locations</th>
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
                      <td className="p-2 font-mono">{r.phone ?? "—"}</td>
                      <td className="p-2">
                        {r.primaryRole} · ${r.rate} {r.rateType}
                        {r.additionalRoles.length > 0 && (
                          <span className="text-gray-500"> +{r.additionalRoles.length} more</span>
                        )}
                      </td>
                      <td className="p-2">{r.locations.join(", ") || <span className="text-gray-400">default</span>}</td>
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
