"use client";

import { useEffect, useRef, useState } from "react";

// Hard upper bound on the raw file we accept, so a 50MB RAW doesn't lock
// up the browser trying to decode it. Phone photos are typically well
// under this.
const MAX_INPUT_BYTES = 15_000_000; // 15 MB

// What we actually store: a square-ish avatar re-encoded as JPEG. 400px
// is plenty for a 40px rendered avatar at 3x density, and 0.85 quality
// keeps JPEG around 40-80KB for a typical headshot.
const TARGET_PX = 400;
const JPEG_QUALITY = 0.85;

// Size of the preview area inside the crop modal.
const PREVIEW_PX = 320;

/**
 * Image picker that reads the selected file, opens a crop modal where
 * the staffer positions + zooms the image inside a circular preview,
 * then re-encodes the cropped square as a ~400px JPEG and stashes it
 * in a hidden input the server action reads back.
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
  const [cropping, setCropping] = useState<HTMLImageElement | null>(null);
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
      const img = await decodeFile(file);
      setCropping(img);
    } catch {
      setError("Couldn't read that image. Try a JPG or PNG.");
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setDataUrl(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onCropConfirm(cropped: string) {
    setDataUrl(cropped);
    setCropping(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onCropCancel() {
    setCropping(null);
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
          {busy && <p className="text-xs text-gray-500">Loading…</p>}
          {dataUrl && (
            <button type="button" onClick={clear} className="text-xs text-red-600 hover:underline text-left">
              Remove photo
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      <input type="hidden" name={name} value={dataUrl ?? ""} />
      {cropping && (
        <CropModal image={cropping} onConfirm={onCropConfirm} onCancel={onCropCancel} />
      )}
    </div>
  );
}

/**
 * Crop UI: the image sits behind a fixed circular viewport. The staffer
 * drags the image to pan and uses a slider to zoom. The viewport is the
 * crop frame; whatever's inside it when they click "Looks good" gets
 * drawn to the canvas at TARGET_PX x TARGET_PX and encoded as JPEG.
 */
function CropModal({
  image,
  onConfirm,
  onCancel,
}: {
  image: HTMLImageElement;
  onConfirm: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  // Base image size (zoom=1): fit the shorter side exactly to the viewport
  // ("cover" behavior) so there are no empty bars at zoom=1 regardless of
  // the source orientation.
  const minImgSide = Math.min(image.naturalWidth, image.naturalHeight);
  const baseW = (image.naturalWidth / minImgSide) * PREVIEW_PX;
  const baseH = (image.naturalHeight / minImgSide) * PREVIEW_PX;

  const [zoom, setZoom] = useState(1);
  // Pan offset, in displayed CSS pixels (POST-scale). (0,0) = image centered.
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const draggingRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Max pan allowed at the current zoom so the crop square stays covered.
  function clampAt(nx: number, ny: number, z: number) {
    const maxX = Math.max(0, (baseW * z - PREVIEW_PX) / 2);
    const maxY = Math.max(0, (baseH * z - PREVIEW_PX) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, nx)),
      y: Math.min(maxY, Math.max(-maxY, ny)),
    };
  }

  function changeZoom(next: number) {
    // Image scales around its own center (CSS transform origin = center),
    // so the visual pan in display pixels stays correct across zoom changes.
    // We only need to re-clamp against the new, larger/smaller bounds.
    setZoom(next);
    setOffset((o) => clampAt(o.x, o.y, next));
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    draggingRef.current = { startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = draggingRef.current;
    if (!d) return;
    const nx = d.origX + (e.clientX - d.startX);
    const ny = d.origY + (e.clientY - d.startY);
    setOffset(clampAt(nx, ny, zoom));
  }
  function onPointerUp(e: React.PointerEvent) {
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch {}
    draggingRef.current = null;
  }

  function confirm() {
    // Visible displayed image dimensions in CSS pixels.
    const dispW = baseW * zoom;
    const dispH = baseH * zoom;
    // Source pixels per display pixel at current zoom.
    const srcPerDisp = image.naturalWidth / dispW; // same ratio for height
    // Viewport side in source-image pixels:
    const viewSrcSide = PREVIEW_PX * srcPerDisp;
    // Image center in source coords is at (naturalW/2, naturalH/2). The
    // pan `offset` in display pixels shifts the image rightward/downward
    // visually, which is equivalent to the viewport sitting LEFT/UP by the
    // same amount in source coords.
    const srcCenterX = image.naturalWidth / 2 - offset.x * srcPerDisp;
    const srcCenterY = image.naturalHeight / 2 - offset.y * srcPerDisp;
    const sx = Math.max(0, srcCenterX - viewSrcSide / 2);
    const sy = Math.max(0, srcCenterY - viewSrcSide / 2);
    const sw = Math.min(image.naturalWidth - sx, viewSrcSide);
    const sh = Math.min(image.naturalHeight - sy, viewSrcSide);
    const canvas = document.createElement("canvas");
    canvas.width = TARGET_PX;
    canvas.height = TARGET_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, TARGET_PX, TARGET_PX);
    onConfirm(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Crop your photo</h2>
        <p className="text-sm text-gray-600 mt-1">
          Drag to reposition. Use the slider to zoom. Whatever&apos;s inside the circle
          becomes your avatar.
        </p>

        <div className="mt-4 flex justify-center">
          <div
            className="relative bg-gray-900 overflow-hidden select-none touch-none"
            style={{ width: PREVIEW_PX, height: PREVIEW_PX, borderRadius: 8 }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.src}
              alt=""
              draggable={false}
              style={{
                position: "absolute",
                width: baseW,
                height: baseH,
                left: "50%",
                top: "50%",
                // Center the base image, then pan (display px) then zoom
                // from its own center. Order matters: translate must come
                // BEFORE scale so pan is applied in display pixels.
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                transformOrigin: "center center",
                cursor: "grab",
                userSelect: "none",
                pointerEvents: "none",
                willChange: "transform",
              }}
            />
            {/* Circular crop mask overlay */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                boxShadow: `0 0 0 9999px rgba(0,0,0,0.45)`,
                borderRadius: "50%",
              }}
            />
            <div
              className="absolute inset-0 pointer-events-none border-2 border-white/80"
              style={{ borderRadius: "50%" }}
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="flex items-center gap-3 text-sm text-gray-700">
            <span className="text-gray-500">Zoom</span>
            <input
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(e) => changeZoom(Number(e.target.value))}
              className="flex-1"
            />
          </label>
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          <button type="button" onClick={onCancel} className="btn btn-secondary text-sm">
            Cancel
          </button>
          <button type="button" onClick={confirm} className="btn btn-primary text-sm">
            Looks good
          </button>
        </div>
      </div>
    </div>
  );
}

async function decodeFile(file: File): Promise<HTMLImageElement> {
  const srcDataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("decode failed"));
    el.src = srcDataUrl;
  });
}
