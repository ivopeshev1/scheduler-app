"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * "Send BEO" button for an event card. Opens a modal with a file picker +
 * optional note, then POSTs the attachment to a server action that emails
 * every accepted staffer on the event. Shows a dev-friendly success/error
 * banner inline so the manager knows what happened without leaving the
 * calendar.
 */
export function SendBeoButton({
  eventId,
  action,
}: {
  eventId: string;
  action: (formData: FormData) => Promise<{ ok: boolean; sentTo: number; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ ok: boolean; sentTo: number; error?: string } | null>(null);
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Clear the contentEditable each time the modal opens so leftover HTML
  // from a previous send doesn't carry over.
  useEffect(() => {
    if (open && noteRef.current) {
      noteRef.current.innerHTML = "";
    }
  }, [open]);

  function reset() {
    setFile(null);
    if (noteRef.current) noteRef.current.innerHTML = "";
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    setPending(true);
    const fd = new FormData();
    fd.set("eventId", eventId);
    // noteHtml carries the formatted paste from the contentEditable div.
    // Server sanitizes to an allowlist before injecting into the email.
    fd.set("noteHtml", noteRef.current?.innerHTML ?? "");
    fd.set("file", file);
    try {
      const r = await action(fd);
      setResult(r);
      if (r.ok) {
        startTransition(() => {
          router.refresh();
        });
      }
    } catch (err) {
      setResult({ ok: false, sentTo: 0, error: String(err) });
    } finally {
      setPending(false);
    }
  }

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
                <p className="text-xs text-gray-500">Emailed to every accepted staffer on this event.</p>
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

            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <label className="label">BEO file</label>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,image/*,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-gray-300 file:bg-white file:text-sm file:text-gray-700 hover:file:bg-gray-50"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  PDF, Word, Excel, or image. Max 10 MB.
                </p>
              </div>

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
                  Paste directly from Google Docs, Notion, Word, etc. - formatting (bold, bullets, headers, emoji) is kept.
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
                  disabled={!file || pending}
                  className="btn btn-primary"
                >
                  {pending ? "Sending…" : "Send BEO"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
