"use client";

import { useRef, useState } from "react";

// Hard upper bound on the raw file we accept, so a 50MB RAW doesn't lock
// up the browser trying to decode it. Phone photos are typically well
// under this.
const MAX_INPUT_BYTES = 15_000_000; // 15 MB

// What we actually store: a square-ish avatar re-encoded as JPEG. 400px
// is plenty for a 40px rendered avatar at 3x density, and 0.85 quality
// keeps JPEG around 40-80KB for a typical headshot.
const TARGET_PX = 400;
const JPEG_QUALITY = 0.85;

/**
 * Image picker that reads the selected file, auto-downscales it to a
 * ~400px JPEG avatar in the browser, and stashes the resulting data URL
 * in a hidden input the server action reads back. The staffer doesn't
 * have to think about dimensions or file size - we clamp both.
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
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onPicked(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please pick an image file.");
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      setError(`That image is huge (${Math.round(file.size / 1024 / 1024)} MB). Pick one under 15 MB.`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const shrunk = await shrinkToAvatar(file);
      setDataUrl(shrunk);
    } catch (e) {
      setError("Couldn't read that image. Try a JPG or PNG.");
    } finally {
      setBusy(false);
    }
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
            disabled={busy}
            onChange={(e) => onPicked(e.target.files?.[0] ?? null)}
            className="block text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-gray-300 file:bg-white file:text-sm file:text-gray-700 hover:file:bg-gray-50 disabled:opacity-50"
          />
          {busy && <p className="text-xs text-gray-500">Resizing…</p>}
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

/**
 * Read the file, decode it in an <img>, center-crop to a square, draw to
 * a TARGET_PX canvas, and re-encode as a JPEG data URL. Keeps the stored
 * blob small + consistent regardless of what the staffer uploaded.
 */
async function shrinkToAvatar(file: File): Promise<string> {
  const srcDataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("decode failed"));
    el.src = srcDataUrl;
  });
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = TARGET_PX;
  canvas.height = TARGET_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, side, side, 0, 0, TARGET_PX, TARGET_PX);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}
