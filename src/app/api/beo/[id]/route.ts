import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";

/**
 * Manager-only BEO file download. Serves the stored base64 payload for a
 * single revision as a downloadable attachment, after checking the session
 * manages the event's company. Returns 404 for missing / cross-company
 * ids so the endpoint doesn't leak which revisions exist.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [beo] = await db.select().from(schema.eventBeos).where(eq(schema.eventBeos.id, params.id));
  if (!beo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [event] = await db.select().from(schema.events).where(eq(schema.events.id, beo.eventId));
  if (!event || event.companyId !== session.companyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const buffer = Buffer.from(beo.fileData, "base64");
  const ext = (beo.filename.split(".").pop() ?? "").toLowerCase();
  const contentType = (
    ext === "pdf" ? "application/pdf"
    : ext === "doc" ? "application/msword"
    : ext === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : ext === "xls" ? "application/vnd.ms-excel"
    : ext === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : ext === "png" ? "image/png"
    : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
    : ext === "gif" ? "image/gif"
    : "application/octet-stream"
  );
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${beo.filename.replace(/"/g, "")}"`,
    },
  });
}
