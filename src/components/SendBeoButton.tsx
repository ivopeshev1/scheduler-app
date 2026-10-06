"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type SendBeoContext = {
  // Was a BEO already emailed for this event?
  hasPrevious: boolean;
  // Filename of the previously-sent BEO (null when hasPrevious is false)
  lastFilename: string | null;
  // ISO timestamp of the last send (null when hasPrevious is false)
  lastSentAt: string | null;
  // Count of accepted staff on the event
  totalAccepted: number;
  // Count of accepted staff who've never been emailed the BEO (new joiners)
  newStaffCount: number;
};

/**
 * "Send BEO" button for an event card. First time it's clicked the modal
 * asks for a file + optional note and emails every accepted staffer. On
 * subsequent clicks the modal uses the context prop to pick smart
 * defaults:
 *   - Reuse the previously-sent file (checkbox default on) or upload a
 *     new version
 *   - "Who gets this": default to Only new staff when reusing the file,
 *     Everyone (and reset confirmations) when uploading a new file
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
  const [reuseLast, setReuseLast] = useState<boolean>(context.hasPrevious);
  const defaultMode: "all" | "only-new" =
    context.hasPrevious && context.newStaffCount > 0 && context.newStaffCount < context.totalAccepted
      ? "only-new"
      : "all";
  const [mode, setMode] = useState<"all" | "only-new">(defaultMode);
  const [result, setResult] = useState<{ ok: boolean; sentTo: number; error?: string } | null>(null);
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (open && noteRef.current) {
      noteRef.current.innerHTML = "";
    }
    if (open) {
      // Re-sync defaults each time the modal opens so a fresh accept
      // between opens flips the recipient radio accordingly.
      setFile(null);
      setResult(null);
      setReuseLast(context.hasPrevious);
      setMode(defaultMode);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [open, context.hasPrevious, defaultMode]);

  // Picking a new file forces a revision - the previous file is being
  // superseded, so defaults flip to Everyone + stop reusing.
  function onFilePicked(f: File | null) {
    setFile(f);
    if (f) {
      setReuseLast(false);
      setMode("all");
    }
  }

  function reset() {
    setFile(null);
    if (noteRef.current) noteRef.current.innerHTML = "";
    setResult(null);
    setReuseLast(context.hasPrevious);
    setMode(defaultMode);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file && !reuseLast) return;
    setPending(true);
    const fd = new FormData();
    fd.set("eventId", eventId);
    fd.set("noteHtml", noteRef.current?.innerHTML ?? "");
    fd.set("mode", mode);
    fd.set("reuseLast", reuseLast && !file ? "1" : "0");
    if (file) fd.set("file", file);
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

  const lastSentLabel = context.lastSentAt
    ? new Date(context.lastSentAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  const everyoneRadioLabel = `Everyone (${context.totalAccepted}) - resets confirmations`;
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
                  {context.hasPrevious
                    ? `Last BEO sent ${lastSentLabel}. Pick what to send below.`
                    : "Emailed to every accepted staffer on this event."}
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
              {/* File row: reuse-last toggle (when applicable) + new file picker */}
              <div>
                <label className="label">BEO file</label>
                {context.hasPrevious && context.lastFilename && (
                  <label className="flex items-center gap-2 text-sm mb-2">
                    <input
                      type="checkbox"
                      checked={reuseLast && !file}
                      onChange={(e) => {
                        setReuseLast(e.target.checked);
                        if (e.target.checked) {
                          setFile(null);
                          if (inputRef.current) inputRef.current.value = "";
                        }
                      }}
                      className="w-4 h-4"
                    />
                    <span>
                      Reuse last file:{" "}
                      <span className="font-medium">{context.lastFilename}</span>
                    </span>
                  </label>
                )}
                <input
                  ref={inputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,image/*,application/pdf"
                  onChange={(e) => onFilePicked(e.target.files?.[0] ?? null)}
                  className="block text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-gray-300 file:bg-white file:text-sm file:text-gray-700 hover:file:bg-gray-50"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {context.hasPrevious
                    ? "Upload a new version to send it as a revision, or leave empty to reuse the last file."
                    : "PDF, Word, Excel, or image. Max 10 MB."}
                </p>
              </div>

              {/* Recipient picker (only meaningful after a first send) */}
              {context.hasPrevious && (
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

              {/* Rich-text note */}
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
                  disabled={(!file && !reuseLast) || pending}
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
