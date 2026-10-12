"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * Click-to-open dropdown anchored to the user avatar in the top-right
 * of the header. Shows the signed-in name + a role badge (Owner /
 * Manager / Staff) at the top, then links the user needs for their
 * personal account: My profile, My settings, Company settings (owner-
 * only), Log out.
 *
 * Pure UI — the parent passes in flags and labels; this component just
 * handles the open/close dance and keyboard dismiss. Dropdown positioning
 * is simple absolute right-aligned since it only ever lives in the header.
 */
export function UserMenu({
  displayName,
  email,
  photoUrl,
  roleBadge,
  profileHref,
  mySettingsHref,
  companySettingsHref,
  showCompanySettings,
}: {
  displayName: string;
  email: string;
  photoUrl?: string | null;
  roleBadge: "Owner" | "Manager" | "Staff";
  profileHref: string;
  mySettingsHref: string | null;
  companySettingsHref: string;
  showCompanySettings: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const badgeColor =
    roleBadge === "Owner" ? "bg-gray-900 text-white"
    : roleBadge === "Manager" ? "bg-blue-100 text-blue-800"
    : "bg-emerald-100 text-emerald-800";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 hover:opacity-80 cursor-pointer"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar email={email} photoUrl={photoUrl} />
        <span className="text-gray-500 hidden md:inline">{displayName}</span>
        <span className="text-gray-400 text-xs leading-none select-none">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-64 bg-white border rounded-lg shadow-lg z-50 overflow-hidden"
        >
          <div className="px-4 py-3 border-b bg-gray-50">
            <div className="font-medium text-gray-900 flex items-center gap-2">
              <span className="truncate">{displayName}</span>
              <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${badgeColor}`}>
                {roleBadge}
              </span>
            </div>
            <div className="text-xs text-gray-500 truncate mt-0.5">{email}</div>
          </div>

          <nav className="flex flex-col py-1 text-sm">
            <Link
              href={profileHref}
              onClick={() => setOpen(false)}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100"
              role="menuitem"
            >
              My profile
            </Link>
            {mySettingsHref && (
              <Link
                href={mySettingsHref}
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100"
                role="menuitem"
              >
                My settings
              </Link>
            )}
            {showCompanySettings && (
              <Link
                href={companySettingsHref}
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100"
                role="menuitem"
              >
                Company settings
              </Link>
            )}
          </nav>

          <form action="/logout" method="post" className="border-t">
            <button
              type="submit"
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
              role="menuitem"
            >
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function Avatar({ email, photoUrl }: { email: string; photoUrl?: string | null }) {
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt=""
        className="w-8 h-8 rounded-full object-cover shrink-0"
        aria-label={`Signed in as ${email}`}
      />
    );
  }
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[.\-_+]/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : (local.slice(0, 2) || "?").toUpperCase();
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const style: React.CSSProperties = {
    background: `hsl(${hue}, 55%, 85%)`,
    color: `hsl(${hue}, 45%, 25%)`,
  };
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center font-semibold text-xs shrink-0"
      style={style}
      aria-label={`Signed in as ${email}`}
    >
      {initials}
    </div>
  );
}
