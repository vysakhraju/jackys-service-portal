import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

// Minimum total drawn distance (CSS px) before a stroke counts as a real signature rather
// than an accidental tap or jitter. A canvas has no built-in "was anything drawn" signal
// the way a file input's null-vs-file check gives for free - the-fool pre-mortem finding:
// without this, a single accidental tap would produce a technically non-empty (but visually
// blank) toDataURL() output that still passes CapturePodForm's existing
// `!signatureBase64 && !photoBase64` submit guard.
const MIN_DRAWN_DISTANCE = 12;

// Canvas-based draw-to-sign input, built to replace CapturePodForm's plain
// <input type="file"> signature field (see DeliveriesPage.tsx). Exports the exact same
// shape that field already produced - a base64 PNG data URI string, via onChange - so
// nothing downstream (capturePod's signatureBase64 param, the backend's arbitrary-string
// storage) needed to change. No external signature-pad library: a canvas plus Pointer
// Events (which unify mouse/touch/pen) is enough for this.
//
// Two more the-fool findings baked in, since real usage is a driver's phone/tablet, not
// this dev machine: (1) the canvas's drawing-buffer resolution is set to its displayed CSS
// size scaled by devicePixelRatio, not left at the browser's low-DPI default, so a
// signature drawn on a high-DPI screen isn't blurry or offset from where the finger
// actually touched. (2) touchAction: 'none' on the drawing surface stops the page from
// scrolling out from under a finger mid-signature, which the default touch behavior would
// otherwise do.
export function SignaturePad({
  onChange,
  className,
}: {
  onChange: (dataUrl: string | undefined) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const totalDistanceRef = useRef(0);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f172a';
    }
  }, []);

  function getPoint(e: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPointRef.current = getPoint(e);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const last = lastPointRef.current;
    if (!canvas || !ctx || !last) return;
    const point = getPoint(e);
    totalDistanceRef.current += Math.hypot(point.x - last.x, point.y - last.y);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
  }

  function finishStroke() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    if (totalDistanceRef.current >= MIN_DRAWN_DISTANCE) {
      setHasSignature(true);
      onChange(canvasRef.current?.toDataURL('image/png'));
    }
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    }
    totalDistanceRef.current = 0;
    setHasSignature(false);
    onChange(undefined);
  }

  return (
    <div className={className}>
      <div
        ref={containerRef}
        data-testid="signature-pad-surface"
        className="relative h-28 w-full rounded-md border border-slate-300 bg-white"
        style={{ touchAction: 'none' }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={hasSignature ? 'Captured signature' : 'Signature pad, empty'}
          className="h-28 w-full cursor-crosshair rounded-md"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerLeave={finishStroke}
        />
        {!hasSignature && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-300">
            Sign here
          </p>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs text-slate-400">{hasSignature ? 'Signature captured' : 'Draw a signature above'}</span>
        <button
          type="button"
          onClick={handleClear}
          disabled={!hasSignature}
          className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
