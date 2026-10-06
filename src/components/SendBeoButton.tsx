"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type BeoRevision = {
  id: string;
  version: number;
  filename: string;
  sentAt: string;
};

export type SendBeoContext = {
  // Full revision history for the event, oldest first.
  revisions: BeoRevision[];
  // Count of accepted staff on the event.
  totalAccepted: number;
  // Count of accepted staff who've never been emailed a BEO.
  newStaffCount: number;
};

/**
 * "Send BEO" button + modal for an event card. Lists every BEO revision
 * uploaded for the event with per-revision Send and View actions, lets
 * the manager upload a new revision, and picks recipient mode:
 *   - Everyone (resets confirmations) - the default for a new upload
 *   - Only new staff - the default when re-sending an existing revision
 *     to new joiners
 */
export function SendBeoButton({
  eventId,
  action,
  context,
}: {
  eventId: string;
  action: (formData: FormData) => Promise<{ ok: boolean; sentTo: number; error?: string }>;
  context: SendBeoContext;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  // Which existing revision is selected (if any). null = uploading new.
  const [selectedBeoId, setSelectedBeoId] = useState<string | null>(
    context.revisions[context.revisions.length - 1]?.id ?? null
  );
  const defaultMode = (): "all" | "only-new" => {
    // If there are new joiners to catch up and we're not uploading a new
    // file, default to only-new. Otherwise everyone.
    if (!file && selectedBeoId && context.newStaffCount > 0 && context.newStaffCount < context.totalAccepted) {
      return "only-new";
    }
    return "all";
  };
  const [mode, setMode] = useState<"all" | "only-new">(defaultMode);
  const [result, setResult] = useState<{ ok: boolean; sentTo: number; error?: string } | null>(null);
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    if (noteRef.current) noteRef.current.innerHTML = "";
    setFile(null);
    setResult(null);
    setSelectedBeoId(context.revisions[context.revisions.length - 1]?.id ?? null);
    setMode(
      context.revisions.length > 0 && context.newStaffCount > 0 && context.newStaffCount < context.totalAccepted
        ? "only-new"
        : "all"
    );
    if (inputRef.current) inputRef.current.value = "";
  }, [open, context]);

  function pickExisting(id: string) {
    setSelectedBeoId(id);
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
    // Re-sending an existing one: assume "only new staff" when there are any.
    setMode(context.newStaffCount > 0 && context.newStaffCount < context.totalAccepted ? "only-new" : "all");
  }

  function pickNewFile(f: File | null) {
    setFile(f);
    if (f) {
      setSelectedBeoId(null);
      // New upload = treat as revision; everyone gets it.
      setMode("all");
    }
  }

  function reset() {
    setFile(null);
    if (noteRef.current) noteRef.current.innerHTML = "";
    setResult(null);
    setSelectedBeoId(context.revisions[context.revisions.length - 1]?.id ?? null);
    setMode(defaultMode);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file && !selectedBeoId) return;
    setPending(true);
    const fd = new FormData();
    fd.set("eventId", eventId);
    fd.set("noteHtml", noteRef.current?.innerHTML ?? "");
    fd.set("mode", mode);
    if (file) {
      fd.set("file", file);
    } else if (selectedBeoId) {
      fd.set("beoId", selectedBeoId);
    }
    try {
      const r = await action(fd);
      setResult(r);
      if (r.ok) {
        startTransition(() => router.refresh());
      }
    } catch (err) {
      setResult({ ok: false, sentTo: 0, error: String(err) });
    } finally {
      setPending(false);
    }
  }

  const everyoneRadioLabel = `Everyone (${context.totalAccepted})${context.revisions.length > 0 ? " - resets confirmations" : ""}`;
  const newStaffRadioLabel = `Only new staff (${context.newStaffCount})`;
  const sendButtonLabel = (() => {
    if (pending) return "Sending…";
    const count = mode === "only-new" ? context.newStaffCount : context.totalAccepted;
    if (count === 0) return "No recipients";
    return `Send BEO to ${count}`;
  })();

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="btn btn-secondary text-sm"
      >
        Send BEO
      </button>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setOpen(false); reset(); } }}
        >
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-lg">Send BEO</h3>
                <p className="text-xs text-gray-500">
                  {context.revisions.length === 0
                    ? "Emailed to every accepted staffer on this event."
                    : `${context.revisions.length} revision${context.revisions.length === 1 ? "" : "s"} on file. Pick one to re-send or upload a new one.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setOpen(false); reset(); }}
                className="text-gray-400 hover:text-gray-700 text-lg leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              {context.revisions.length > 0 && (
                <div>
                  <label className="label">Which BEO to send</label>
                  <div className="border rounded divide-y">
                    {context.revisions.map((r) => {
                      const date = new Date(r.sentAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
                      const selected = selectedBeoId === r.id && !file;
                      return (
                        <div key={r.id} className={`flex items-center gap-2 px-3 py-2 text-sm ${selected ? "bg-blue-50" : ""}`}>
                          <label className="flex items-center gap-2 flex-1 cursor-pointer">
                            <input
                              type="radio"
                              name="revision"
                              checked={selected}
                              onChange={() => pickExisting(r.id)}
                              className="w-4 h-4"
                            />
                            <span className="font-medium">BEO {r.version}</span>
                            <span className="text-gray-500 truncate">· {r.filename}</span>
                            <span className="text-xs text-gray-400 ml-auto">{date}</span>
                          </label>
                          <a
                            href={`/api/beo/${r.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-blue-600 hover:underline shrink-0"
                          >
                            View
                          </a>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="label">
                  {context.revisions.length === 0 ? "BEO file" : "Or upload a new revision"}
                </label>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,image/*,application/pdf"
                  onChange={(e) => pickNewFile(e.target.files?.[0] ?? null)}
                  className="block text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-gray-300 file:bg-white file:text-sm file:text-gray-700 hover:file:bg-gray-50"
                />
                <p className="text-xs text-gray-500 mt-1">
                  PDF, Word, Excel, or image. Max 10 MB.
                </p>
              </div>

              {context.revisions.length > 0 && (
                <div>
                  <label className="label">Who gets this</label>
                  <div className="space-y-1 text-sm">
                    <label className={`flex items-start gap-2 ${context.newStaffCount === 0 ? "opacity-50" : ""}`}>
                      <input
                        type="radio"
                        name="mode"
                        checked={mode === "only-new"}
                        disabled={context.newStaffCount === 0}
                        onChange={() => setMode("only-new")}
                        className="w-4 h-4 mt-0.5"
                      />
                      <span>{newStaffRadioLabel}</span>
                    </label>
                    <label className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="mode"
                        checked={mode === "all"}
                        onChange={() => setMode("all")}
                        className="w-4 h-4 mt-0.5"
                      />
                      <span>{everyoneRadioLabel}</span>
                    </label>
                  </div>
                </div>
              )}

              <div>
                <label className="label">Optional note</label>
                <div
                  ref={noteRef}
                  contentEditable
                  suppressContentEditableWarning
                  data-placeholder="Paste or type your BEO notes. Bold, bullets, emoji, and line breaks are preserved."
                  className="input min-h-[120px] max-h-[320px] overflow-y-auto whitespace-normal [&:empty:before]:content-[attr(data-placeholder)] [&:empty:before]:text-gray-400"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Paste directly from Google Docs, Notion, Word, etc. - formatting is kept.
                </p>
              </div>

              {result && (
                <div className={`text-sm rounded px-3 py-2 ${result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                  {result.ok
                    ? `Sent to ${result.sentTo} staff.`
                    : `Error: ${result.error ?? "unknown"}`}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setOpen(false); reset(); }}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={(!file && !selectedBeoId) || pending}
                  className="btn btn-primary"
                >
                  {sendButtonLabel}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
