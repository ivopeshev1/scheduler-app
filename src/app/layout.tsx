import type { Metadata } from "next";
import "./globals.css";
import { ensureMigrations } from "@/lib/migrations";

export const metadata: Metadata = {
  title: "Scheduler",
  description: "Event staffing scheduler",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Runs idempotent DDL (CREATE TABLE IF NOT EXISTS / ALTER TABLE IF NOT
  // EXISTS / etc) once per serverless cold start, so the database stays in
  // sync with the code automatically on every deploy — no manual /api/setup
  // step needed.
  await ensureMigrations();
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-gray-900">{children}</body>
    </html>
  );
}
