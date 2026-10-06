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
  revisions: BeoRevision[];
  totalAccepted: number;
  newStaffCount: number;
};

/**
 * Send BEO button + modal. First send prompts for a file. After that
 * the modal lists every revision as its own big action button:
 *   [Send BEO 1 - filename.pdf · Nov 10]   View
 *   [Send BEO 2 - revised.pdf · Nov 15]    View
 *   [Send New File]
 * Clicking a revision button sends that specific file with the current
 * note + recipient selection. "Send New File" expands into a file
 * picker, then the newly uploaded version is sent as BEO N+1.
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
  // When true, show the file picker in place of the Send New File button.
  const [showUpload, setShowUpload] = useState(context.revisions.length === 0);
  const defaultMode: "all" | "only-new" =
    context.revisions.length > 0 && context.newStaffCount > 0 && context.newStaffCount < context.totalAccepted
      ? "only-new"
      : "all";
  const [mode, setMode] = useState<"all" | "only-new">(defaultMode);
  const [result, setResult] = useState<{ ok: boolean; sentTo: number; error?: string } | null>(null);
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState<string | "new" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    if (noteRef.current) noteRef.current.innerHTML = "";
    setFile(null);
    setResult(null);
    setShowUpload(context.revisions.length === 0);
    setMode(defaultMode);
    if (inputRef.current) inputRef.current.value = "";
  }, [open, context, defaultMode]);

  async function send(opts: { beoId?: string; useFile?: boolean }) {
    if (opts.useFile && !file) return;
    setPending(opts.useFile ? "new" : opts.beoId ?? null);
    setResult(null);
    const fd = new FormData();
    fd.set("eventId", eventId);
    fd.set("noteHtml", noteRef.current?.innerHTML ?? "");
    fd.set("mode", mode);
    if (opts.useFile && file) {
      fd.set("file", file);
    } else if (opts.beoId) {
      fd.set("beoId", opts.beoId);
    }
    try {
      const r = await action(fd);
      setResult(r);
      if (r.ok) startTransition(() => router.refresh());
    } catch (err) {
      setResult({ ok: false, sentTo: 0, error: String(err) });
    } finally {
      setPending(null);
    }
  }

  function reset() {
    setFile(null);
    if (noteRef.current) noteRef.current.innerHTML = "";
    setResult(null);
    setShowUpload(context.revisions.length === 0);
    setMode(defaultMode);
    if (inputRef.current) inputRef.current.value = "";
  }

  const recipientCount = mode === "only-new" ? context.newStaffCount : context.totalAccepted;

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
                    : `${context.revisions.length} revision${context.revisions.length === 1 ? "" : "s"} on file.`}
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

            <div className="space-y-4">
              {/* Note first - applies to whichever Send button is clicked */}
              <div>
                <label className="label">Optional note</label>
                <div
                  ref={noteRef}
                  contentEditable
                  suppressContentEditableWarning
                  data-placeholder="Paste or type your BEO notes. Bold, bullets, emoji, and line breaks are preserved."
                  className="input min-h-[100px] max-h-[260px] overflow-y-auto whitespace-normal [&:empty:before]:content-[attr(data-placeholder)] [&:empty:before]:text-gray-400"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Paste from Google Docs, Notion, Word, etc. - formatting kept.
                </p>
              </div>

              {/* Recipient picker (only after a first BEO exists) */}
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
                      <span>Only new staff ({context.newStaffCount})</span>
                    </label>
                    <label className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="mode"
                        checked={mode === "all"}
                        onChange={() => setMode("all")}
                        className="w-4 h-4 mt-0.5"
                      />
                      <span>Everyone ({context.totalAccepted}) - resets confirmations</span>
                    </label>
                  </div>
                </div>
              )}

              {/* One send button per existing revision */}
              {context.revisions.length > 0 && (
                <div>
                  <label className="label">Pick a BEO to send</label>
                  <div className="space-y-2">
                    {context.revisions.map((r) => {
                      const date = new Date(r.sentAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
                      const isPending = pending === r.id;
                      return (
                        <div key={r.id} className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => send({ beoId: r.id })}
                            disabled={pending !== null || recipientCount === 0}
                            className="btn btn-primary flex-1 justify-between text-left text-sm"
                          >
                            <span>
                              <span className="font-semibold">Send BEO {r.version}</span>
                              <span className="opacity-80"> · {r.filename}</span>
                            </span>
                            <span className="opacity-70 text-xs">{isPending ? "Sending…" : `→ ${recipientCount}`}</span>
                          </button>
                          <a
                            href={`/api/beo/${r.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:underline shrink-0 px-2"
                          >
                            View
                          </a>
                          <span className="text-xs text-gray-400 shrink-0 w-14 text-right">{date}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* New file flow - button on first click reveals the picker */}
              <div>
                {!showUpload ? (
                  <button
                    type="button"
                    onClick={() => setShowUpload(true)}
                    className="btn btn-secondary w-full"
                    disabled={pending !== null}
                  >
                    Send New File (BEO {context.revisions.length + 1})
                  </button>
                ) : (
                  <>
                    <label className="label">
                      {context.revisions.length === 0 ? "BEO file" : `New revision (BEO ${context.revisions.length + 1})`}
                    </label>
                    <input
                      ref={inputRef}
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,image/*,application/pdf"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      className="block text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-gray-300 file:bg-white file:text-sm file:text-gray-700 hover:file:bg-gray-50"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      PDF, Word, Excel, or image. Max 10 MB.
                    </p>
                    <button
                      type="button"
                      onClick={() => send({ useFile: true })}
                      disabled={!file || pending !== null || recipientCount === 0}
                      className="btn btn-primary w-full mt-2 justify-between text-left text-sm"
                    >
                      <span className="font-semibold">
                        {pending === "new"
                          ? "Sending…"
                          : `Send New File${context.revisions.length > 0 ? ` (BEO ${context.revisions.length + 1})` : ""}`}
                      </span>
                      <span className="opacity-70 text-xs">→ {recipientCount}</span>
                    </button>
                  </>
                )}
              </div>

              {result && (
                <div className={`text-sm rounded px-3 py-2 ${result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                  {result.ok
                    ? `Sent to ${result.sentTo} staff.`
                    : `Error: ${result.error ?? "unknown"}`}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
