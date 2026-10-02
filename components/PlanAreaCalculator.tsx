'use client';

/**
 * 도면 이미지로 물량 계산 — 드래그 → OCR → 가로·세로 → 면적 → 물량.
 *
 * 위치 추측을 하지 않는다. 사용자가 가로 치수가 적힌 부분을 드래그하면 그 안의
 * 숫자를 전부 더하고, 그다음 드래그는 세로로 — 순서대로 진행된다. 세로는 도면에서
 * 글자가 눕혀 있는 경우가 많아서 시계·반시계로 돌려 가며 재시도한다.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { TRUCK_CAPACITY_M3 } from '@/lib/rules';

declare global {
  interface Window {
    Tesseract?: {
      createWorker: (lang: string) => Promise<TesseractWorker>;
    };
  }
}

interface TesseractWorker {
  setParameters: (params: Record<string, string>) => Promise<void>;
  recognize: (input: string) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<void>;
}

const MAX_W = 340;
const THICKNESS_OPTIONS = [100, 120, 150, 180, 200];
const MARGIN_OPTIONS = [3, 5, 8, 10];

type Box = { x0: number; y0: number; x1: number; y1: number };
type Field = 'w' | 'h';

function loadTesseract(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('load-failed'));
    document.head.appendChild(s);
  });
}

/** 박스(캔버스 좌표)를 원본 해상도로 크롭한다 — 작은 영역은 더 키워서 인식률을 올린다 */
function cropBoxToCanvas(
  img: HTMLImageElement,
  box: Box,
  dispScale: number,
  natW: number,
  natH: number,
): HTMLCanvasElement {
  const x = Math.min(box.x0, box.x1);
  const y = Math.min(box.y0, box.y1);
  const w = Math.abs(box.x1 - box.x0);
  const h = Math.abs(box.y1 - box.y0);
  let sx = x / dispScale;
  let sy = y / dispScale;
  let sw = w / dispScale;
  let sh = h / dispScale;
  const pad = 6;
  sx = Math.max(0, sx - pad);
  sy = Math.max(0, sy - pad);
  sw = Math.min(natW - sx, sw + pad * 2);
  sh = Math.min(natH - sy, sh + pad * 2);
  const scaleUp = sw < 260 ? Math.min(4, 260 / sw) : 2;
  const out = document.createElement('canvas');
  out.width = Math.round(sw * scaleUp);
  out.height = Math.round(sh * scaleUp);
  const octx = out.getContext('2d')!;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out;
}

function rotateCanvas90(src: HTMLCanvasElement, clockwise: boolean): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.height;
  out.height = src.width;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  if (clockwise) {
    ctx.translate(out.width, 0);
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.translate(0, out.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(src, 0, 0);
  return out;
}

async function ocrCanvasForNumbers(canvas: HTMLCanvasElement): Promise<number[]> {
  const worker = await window.Tesseract!.createWorker('eng');
  await worker.setParameters({ tessedit_char_whitelist: '0123456789xX*,. ' });
  const res = await worker.recognize(canvas.toDataURL());
  await worker.terminate();
  const text = res?.data?.text || '';
  const cleaned = text.replace(/(\d)[,.](?=\d)/g, '$1');
  const matches = cleaned.match(/\d{2,6}/g) || [];
  return matches.map((v) => parseInt(v, 10)).filter((v) => v >= 10);
}

/** variants 를 순서대로 시도하다가 숫자를 찾으면 멈춘다 */
async function runOcrVariants(cropped: HTMLCanvasElement, variants: string[]): Promise<number[]> {
  for (let i = 0; i < variants.length; i++) {
    const canvas =
      variants[i] === 'cw'
        ? rotateCanvas90(cropped, true)
        : variants[i] === 'ccw'
          ? rotateCanvas90(cropped, false)
          : cropped;
    try {
      const nums = await ocrCanvasForNumbers(canvas);
      if (nums.length || i === variants.length - 1) return nums;
    } catch {
      if (i === variants.length - 1) return [];
    }
  }
  return [];
}

function sumLabel(list: number[]): { total: number; label: string } | null {
  if (!list.length) return null;
  const total = list.reduce((a, b) => a + b, 0);
  return { total, label: list.join('+') + (list.length > 1 ? ` = ${total}` : '') };
}

export default function PlanAreaCalculator({ onApply }: { onApply: (volumeM3: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const natSizeRef = useRef({ w: 0, h: 0 });
  const dispScaleRef = useRef(1);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  // mouseup 이 state 커밋 전에(연속 이벤트가 한 틱에 몰릴 때) 실행될 수 있어 ref 로도 따로 들고 있는다
  const curBoxRef = useRef<Box | null>(null);

  const [hasImage, setHasImage] = useState(false);
  const [curBox, setCurBox] = useState<Box | null>(null);
  const [nextField, setNextField] = useState<Field>('w');
  const [boxW, setBoxW] = useState('');
  const [boxH, setBoxH] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [areaM2, setAreaM2] = useState<number | null>(null);
  const [thickness, setThickness] = useState(150);
  const [margin, setMargin] = useState(5);
  const [imgVersion, setImgVersion] = useState(0);

  const redraw = useCallback((box: Box | null) => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (box) {
      const x = Math.min(box.x0, box.x1);
      const y = Math.min(box.y0, box.y1);
      const w = Math.abs(box.x1 - box.x0);
      const h = Math.abs(box.y1 - box.y0);
      ctx.strokeStyle = '#8a5a3c';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(138,90,60,.14)';
      ctx.fillRect(x, y, w, h);
    }
  }, []);

  function resetBox() {
    curBoxRef.current = null;
    setCurBox(null);
    setBoxW('');
    setBoxH('');
    setAreaM2(null);
    setNextField('w');
    setStatus('');
  }

  function onPickFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        imgRef.current = img;
        natSizeRef.current = { w: img.naturalWidth, h: img.naturalHeight };
        dispScaleRef.current = Math.min(1, MAX_W / img.naturalWidth);
        resetBox();
        setHasImage(true);
        setImgVersion((v) => v + 1);
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
    // 값을 비워 두지 않으면 같은 파일을 다시 골랐을 때 onChange 가 안 뜬다
    if (fileRef.current) fileRef.current.value = '';
  }

  // 캔버스는 hasImage 가 true 가 돼야 DOM 에 생긴다 — 커밋된 뒤(페인트 전)에 크기를 잡고 그린다
  useLayoutEffect(() => {
    if (!hasImage) return;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    canvas.width = Math.round(natSizeRef.current.w * dispScaleRef.current);
    canvas.height = Math.round(natSizeRef.current.h * dispScaleRef.current);
    redraw(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasImage, imgVersion]);

  function canvasPos(e: ReactMouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onMouseDown(e: ReactMouseEvent<HTMLCanvasElement>) {
    if (!imgRef.current) return;
    const p = canvasPos(e);
    draggingRef.current = true;
    dragStartRef.current = p;
    const box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    curBoxRef.current = box;
    setCurBox(box);
    redraw(box);
  }

  function onMouseMove(e: ReactMouseEvent<HTMLCanvasElement>) {
    if (!draggingRef.current || !dragStartRef.current) return;
    const p = canvasPos(e);
    const box = { x0: dragStartRef.current.x, y0: dragStartRef.current.y, x1: p.x, y1: p.y };
    curBoxRef.current = box;
    setCurBox(box);
    redraw(box);
  }

  async function onMouseUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const box = curBoxRef.current;
    if (!box) return;
    const w = Math.abs(box.x1 - box.x0);
    const h = Math.abs(box.y1 - box.y0);
    if (w < 8 || h < 8) {
      curBoxRef.current = null;
      setCurBox(null);
      redraw(null);
      return;
    }
    await runBoxOcr(box);
  }

  async function runBoxOcr(box: Box) {
    const field = nextField;
    const fieldLabel = field === 'w' ? '가로' : '세로';
    setStatus(`${fieldLabel} 영역에서 숫자를 인식하는 중이에요...`);
    setBusy(true);
    try {
      await loadTesseract();
    } catch {
      setStatus('OCR을 불러오지 못했어요. 아래 값을 직접 입력해주세요.');
      setBusy(false);
      return;
    }
    const img = imgRef.current;
    if (!img) {
      setBusy(false);
      return;
    }
    const cropped = cropBoxToCanvas(img, box, dispScaleRef.current, natSizeRef.current.w, natSizeRef.current.h);
    const variants = field === 'h' ? ['cw', 'ccw', 'plain'] : ['plain'];
    const nums = await runOcrVariants(cropped, variants);
    setBusy(false);
    const s = sumLabel(nums);
    if (s) {
      if (field === 'w') setBoxW(String(s.total));
      else setBoxH(String(s.total));
      const next: Field = field === 'w' ? 'h' : 'w';
      setNextField(next);
      setStatus(
        `${fieldLabel} ${s.label}mm 로 인식했어요. 이제 ${next === 'w' ? '가로' : '세로'} 차례예요. 틀렸으면 아래에서 고쳐주세요.`,
      );
    } else {
      setStatus('선택한 영역에서 숫자를 찾지 못했어요. 드래그 영역을 조금 더 넉넉하게 잡아보거나 아래에 직접 입력해주세요.');
    }
  }

  function calcArea() {
    const w = parseFloat(boxW) || 0;
    const h = parseFloat(boxH) || 0;
    if (!w || !h) {
      setStatus('가로·세로 값을 모두 입력해주세요.');
      return;
    }
    setAreaM2(Math.round((w / 1000) * (h / 1000) * 100) / 100);
    setStatus('');
  }

  const volume = areaM2 != null ? Math.round(areaM2 * (thickness / 1000) * (1 + margin / 100) * 10) / 10 : 0;
  const trucks = areaM2 != null ? Math.max(1, Math.ceil(volume / TRUCK_CAPACITY_M3)) : 0;

  return (
    <div
      style={{
        marginBottom: 14,
        padding: 12,
        border: '1.5px solid var(--color-rust)',
        borderRadius: 'var(--radius-sharp)',
        background: 'var(--color-card)',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: 4 }}>📐 도면으로 물량 계산</div>
      <p style={{ fontSize: '0.8rem', color: 'var(--color-concrete-mid)', margin: '0 0 10px' }}>
        도면 이미지를 올리면 면적을 인식해서 필요한 물량까지 한 번에 계산해요.
      </p>

      {/* 업로드 칸이 사라진 뒤에도 '다른 도면 선택'으로 다시 열 수 있게 input 은 항상 둔다 */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => onPickFile(e.target.files?.[0])}
      />

      {!hasImage && (
        <label
          onClick={() => fileRef.current?.click()}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            textAlign: 'center',
            border: '2px dashed var(--color-rust-soft)',
            borderRadius: 'var(--radius-sharp)',
            background: 'rgba(138,90,60,.06)',
            padding: '22px 14px',
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 24 }}>📐</span>
          <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>도면 이미지 업로드</span>
          <span style={{ fontSize: '0.76rem', color: 'var(--color-concrete-mid)' }}>
            탭해서 사진을 선택하거나 촬영하세요
          </span>
        </label>
      )}

      {hasImage && (
        <div
          style={{
            position: 'relative',
            border: '1px solid var(--color-line-strong)',
            borderRadius: 'var(--radius-sharp)',
            background: 'var(--color-paper)',
            marginBottom: 8,
            overflow: 'auto',
          }}
        >
          <canvas
            ref={canvasRef}
            style={{ display: 'block', maxWidth: '100%', cursor: 'crosshair' }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={() => void onMouseUp()}
          />
        </div>
      )}

      {hasImage && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            다른 도면 선택
          </button>
        </div>
      )}

      {hasImage && (
        <p style={{ fontSize: '0.8rem', color: 'var(--color-concrete-mid)', margin: '0 0 8px' }}>
          지금은 <b>{nextField === 'w' ? '가로' : '세로'}</b> 차례예요. <b>{nextField === 'w' ? '가로' : '세로'}</b>{' '}
          치수가 적힌 부분만 사각형으로 <b>드래그</b>하세요. 숫자가 여러 구간이면 전부 더해요.
        </p>
      )}

      {status && <p style={{ fontSize: '0.8rem', color: 'var(--color-concrete-mid)', margin: '0 0 8px' }}>{status}</p>}

      {hasImage && (boxW || boxH) && (
        <div style={{ marginTop: 4, paddingTop: 10, borderTop: '1px dashed var(--color-line)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="field">
              <span className="label">가로</span>
              <span className="unit-input">
                <input className="input" type="number" value={boxW} onChange={(e) => setBoxW(e.target.value)} />
                <em>mm</em>
              </span>
            </label>
            <label className="field">
              <span className="label">세로</span>
              <span className="unit-input">
                <input className="input" type="number" value={boxH} onChange={(e) => setBoxH(e.target.value)} />
                <em>mm</em>
              </span>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={resetBox}>
              다시 선택
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={calcArea}>
              이 치수로 면적 계산
            </button>
          </div>
        </div>
      )}

      {areaM2 != null && (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
              background: 'rgba(138,90,60,.08)',
              borderRadius: 'var(--radius-sharp)',
              padding: '10px 12px',
              marginTop: 10,
              fontSize: '0.85rem',
            }}
          >
            <span>
              선택 영역 면적 <b style={{ fontSize: '1rem' }}>{areaM2}</b> m²
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <label className="field">
              <span className="label">타설 두께</span>
              <select className="select" value={thickness} onChange={(e) => setThickness(Number(e.target.value))}>
                {THICKNESS_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v} mm
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">여유율</span>
              <select className="select" value={margin} onChange={(e) => setMargin(Number(e.target.value))}>
                {MARGIN_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}%
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
              background: 'rgba(138,90,60,.08)',
              borderRadius: 'var(--radius-sharp)',
              padding: '10px 12px',
              marginTop: 10,
              fontSize: '0.85rem',
            }}
          >
            <span>
              <b style={{ fontSize: '1rem' }}>{volume.toFixed(1)}</b> m³ 필요 · 약 <b>{trucks}</b>대 분량
            </span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onApply(volume)}>
              총 물량에 반영
            </button>
          </div>
        </>
      )}

      {busy && <p style={{ fontSize: '0.78rem', color: 'var(--color-concrete-mid)', marginTop: 8 }}>처리 중…</p>}
    </div>
  );
}
