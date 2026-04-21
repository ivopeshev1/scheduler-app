import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function ManagerIndex() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  redirect(`/manager/month/${month}`);
}
