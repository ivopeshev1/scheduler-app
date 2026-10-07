"use client";

import { useRef, useState } from "react";

const MAX_BYTES = 500_000; // ~500 KB, fits comfortably in the DB row

/**
 * Image picker that reads the selected file into a base64 data URL and
 * stashes it in a hidden input the server action reads back. Used on
 * the manager onboarding form and the manager profile edit page.
 */
export function ProfilePhotoField({
  name = "photoUrl",
  initialDataUrl = null,
}: {
  name?: string;
  initialDataUrl?: string | null;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(initialDataUrl);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onPicked(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please pick an image file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`Image is too large (${Math.round(file.size / 1024)} KB). Max 500 KB.`);
      return;
    }
    setError(null);
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    setDataUrl(url);
  }

  function clear() {
    setDataUrl(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-full bg-gray-100 border overflow-hidden flex items-center justify-center text-gray-400 text-xs shrink-0">
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dataUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            "No photo"
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={(e) => onPicked(e.target.files?.[0] ?? null)}
            className="block text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-gray-300 file:bg-white file:text-sm file:text-gray-700 hover:file:bg-gray-50"
          />
          {dataUrl && (
            <button type="button" onClick={clear} className="text-xs text-red-600 hover:underline text-left">
              Remove photo
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      <input type="hidden" name={name} value={dataUrl ?? ""} />
    </div>
  );
}
