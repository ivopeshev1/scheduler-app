/**
 * CSV template download for the bulk staff importer. Hitting
 * /manager/staff/import/template returns a CSV with the exact column
 * headers the importer expects + two example rows so a manager can
 * open it, replace the examples with their people, and upload.
 *
 * Kept as a separate route (not an inline download link) so we can
 * evolve the template without bundling it into the page.
 */
export function GET() {
  const rows = [
    [
      "first_name",
      "last_name",
      "email",
      "phone",
      "city",
      "primary_role",
      "rate",
      "rate_type",
      "additional_roles",
      "locations",
      "can_drive_van",
    ],
    [
      "Jamie",
      "Rivera",
      "jamie@example.com",
      "805-555-0101",
      "Simi Valley",
      "Bartender",
      "30",
      "hourly",
      "Server:25:hourly;Bar Back:22:hourly",
      "Main Location",
      "yes",
    ],
    [
      "Alex",
      "Chen",
      "alex@example.com",
      "805-555-0102",
      "Thousand Oaks",
      "Event Lead",
      "600",
      "flat",
      "",
      "Main Location",
      "no",
    ],
  ];
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? "");
          // Quote cells containing commas, quotes, or newlines (standard CSV).
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="scheduler-staff-import-template.csv"`,
    },
  });
}
