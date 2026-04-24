"use client";

import { useRef, useState, useTransition } from "react";

export type AttachmentMeta = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
};

const MAX_FILE_BYTES = 5_000_000; // 5 MB per file
const ALLOWED = /^(image\/|application\/pdf$|application\/vnd\.openxmlformats-officedocument\.|application\/msword$|application\/vnd\.ms-excel$|text\/|application\/vnd\.ms-powerpoint$|application\/zip$)/;

/**
 * Dual-purpose attachments control used on event new + edit pages.
 * - Shows the list of files currently attached (if editing an existing event)
 * - Accepts new uploads via a file picker
 * - On submit, stashes uploaded files as base64 data URLs into a hidden input
 *   (newAttachments JSON) for the server action to read. Deletions are
 *   tracked in another hidden input (removeAttachments JSON).
 */
export function AttachmentsField({
  existing,
  label = "Attachments",
}: {
  existing: AttachmentMeta[];
  label?: string;
}) {
  const [currentExisting, setCurrentExisting] = useState<AttachmentMeta[]>(existing);
  const [pending, setPending] = useState<Array<{
    name: string; type: string; size: number; dataUrl: string;
  }>>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();

  async function onFilesPicked(fileList: FileList | null) {
    if (!fileList) return;
    const additions: typeof pending = [];
    for (const f of Array.from(fileList)) {
      if (f.size > MAX_FILE_BYTES) {
        setError(`"${f.name}" is too large (max 5 MB).`);
        continue;
      }
      if (f.type && !ALLOWED.test(f.type)) {
        setError(`"${f.name}" type ${f.type} isn't allowed.`);
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(f);
      });
      additions.push({ name: f.name, type: f.type || "application/octet-stream", size: f.size, dataUrl });
    }
    if (additions.length) {
      setError(null);
      setPending((prev) => [...prev, ...additions]);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeExisting(id: string) {
    setRemoved((prev) => [...prev, id]);
    setCurrentExisting((prev) => prev.filter((a) => a.id !== id));
  }

  function removePending(idx: number) {
    setPending((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <label className="label">{label}</label>
      <p className="text-xs text-gray-500 mb-2">
        PDF, images, Word, Excel, PowerPoint, or text. 5 MB per file.
      </p>

      {currentExisting.length > 0 && (
        <ul className="border rounded divide-y mb-3">
          {currentExisting.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1 truncate">{a.fileName}</span>
              <span className="text-xs text-gray-500 shrink-0">{formatBytes(a.fileSize)}</span>
              <button type="button" onClick={() => removeExisting(a.id)} className="text-xs text-red-600 hover:underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {pending.length > 0 && (
        <ul className="border rounded divide-y mb-3 border-amber-300 bg-amber-50">
          {pending.map((p, idx) => (
            <li key={idx} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1 truncate">{p.name} <span className="text-xs text-amber-700">(new)</span></span>
              <span className="text-xs text-gray-500 shrink-0">{formatBytes(p.size)}</span>
              <button type="button" onClick={() => removePending(idx)} className="text-xs text-red-600 hover:underline">
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={(e) => startTransition(() => { onFilesPicked(e.target.files); })}
        className="block text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-gray-300 file:bg-white file:text-sm file:text-gray-700 hover:file:bg-gray-50"
      />

      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}

      {/* Hidden inputs the server action reads on submit. */}
      <input type="hidden" name="newAttachments" value={JSON.stringify(pending)} />
      <input type="hidden" name="removeAttachments" value={JSON.stringify(removed)} />
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
