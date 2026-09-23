'use client';

/**
 * 카카오맵. 현장·공장·차량 마커와 경로 선을 그린다.
 *
 * NEXT_PUBLIC_KAKAO_JS_KEY 가 없으면 좌표를 그대로 평면에 찍는 대체 지도로 떨어진다.
 * 키 발급 전에도 화면이 비어 보이지 않게 하기 위해서다 (지시서 0-10 을 안내한다).
 */

import { useEffect, useRef, useState } from 'react';
import type { KakaoMap as KMap, KakaoOverlay } from './kakao.d';
import s from './KakaoMap.module.css';

export type MarkerTone = 'ok' | 'warn' | 'bad' | 'accent' | 'muted';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind: 'site' | 'plant' | 'truck';
  label: string;
  tone?: MarkerTone;
  selected?: boolean;
  onClick?: () => void;
}

export interface MapPath {
  id: string;
  points: [number, number][];
  /** 진한 선(추천 경로) / 옅은 선(참고) */
  emphasis?: boolean;
}

interface Props {
  markers: MapMarker[];
  paths?: MapPath[];
  height?: number;
  /** 지정하지 않으면 마커가 전부 보이도록 맞춘다 */
  center?: { lat: number; lng: number };
  level?: number;
}

const SDK_ID = 'kakao-maps-sdk';

export default function KakaoMap({ markers, paths = [], height = 360, center, level }: Props) {
  const key = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KMap | null>(null);
  const overlaysRef = useRef<KakaoOverlay[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>(
    key ? 'loading' : 'failed',
  );

  // ── SDK 로드 ──
  useEffect(() => {
    if (!key) return;

    let cancelled = false;

    const init = () => {
      if (cancelled || !boxRef.current || !window.kakao) return;
      window.kakao.maps.load(() => {
        if (cancelled || !boxRef.current || !window.kakao) return;
        mapRef.current = new window.kakao.maps.Map(boxRef.current, {
          center: new window.kakao.maps.LatLng(center?.lat ?? 37.24, center?.lng ?? 127.08),
          level: level ?? 9,
        });
        setStatus('ready');
      });
    };

    if (window.kakao?.maps) {
      init();
      return () => {
        cancelled = true;
      };
    }

    let script = document.getElementById(SDK_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = SDK_ID;
      script.async = true;
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false`;
      document.head.appendChild(script);
    }
    script.addEventListener('load', init);
    script.addEventListener('error', () => !cancelled && setStatus('failed'));

    return () => {
      cancelled = true;
      script?.removeEventListener('load', init);
    };
    // center·level 은 최초 한 번만 쓴다. 이후 갱신은 아래 effect 가 맡는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // ── 마커·경로 다시 그리기 ──
  useEffect(() => {
    const map = mapRef.current;
    const kakao = window.kakao;
    if (status !== 'ready' || !map || !kakao) return;

    for (const o of overlaysRef.current) o.setMap(null);
    overlaysRef.current = [];

    for (const p of paths) {
      if (p.points.length < 2) continue;
      const line = new kakao.maps.Polyline({
        path: p.points.map(([lat, lng]) => new kakao.maps.LatLng(lat, lng)),
        strokeWeight: p.emphasis ? 5 : 3,
        strokeColor: p.emphasis ? '#8A5A3C' : '#8E8C86',
        strokeOpacity: p.emphasis ? 0.9 : 0.5,
        strokeStyle: 'solid',
        map,
      });
      overlaysRef.current.push(line);
    }

    for (const m of markers) {
      const overlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(m.lat, m.lng),
        content: markerEl(m),
        yAnchor: 1,
        zIndex: m.kind === 'truck' ? 30 : m.selected ? 20 : 10,
        clickable: !!m.onClick,
        map,
      });
      overlaysRef.current.push(overlay);
    }

    // 전부 보이도록 맞춘다
    if (!center && markers.length > 0) {
      const bounds = new kakao.maps.LatLngBounds();
      for (const m of markers) bounds.extend(new kakao.maps.LatLng(m.lat, m.lng));
      for (const p of paths) for (const [lat, lng] of p.points) bounds.extend(new kakao.maps.LatLng(lat, lng));
      map.setBounds(bounds, 40, 40, 40, 40);
    } else if (center) {
      map.setCenter(new kakao.maps.LatLng(center.lat, center.lng));
      if (level) map.setLevel(level);
    }
  }, [status, markers, paths, center, level]);

  return (
    <div className={s.box} style={{ height }}>
      {key ? (
        <>
          <div ref={boxRef} className={s.canvas} />
          {status === 'loading' && <div className={s.loading}>지도 불러오는 중…</div>}
          {status === 'failed' && <FallbackMap markers={markers} paths={paths} reason="sdk" />}
        </>
      ) : (
        <FallbackMap markers={markers} paths={paths} reason="nokey" />
      )}
    </div>
  );
}

function markerEl(m: MapMarker) {
  const el = document.createElement('div');
  el.className = 'rmc-marker';
  el.dataset.kind = m.kind;
  el.dataset.tone = m.tone ?? 'muted';
  if (m.selected) el.dataset.selected = '1';
  if (m.onClick) {
    el.dataset.clickable = '1';
    el.addEventListener('click', m.onClick);
  }
  const dot = document.createElement('span');
  dot.className = 'dot';
  el.appendChild(dot);
  el.appendChild(document.createTextNode(m.label));
  return el;
}

/* ==========================================================================
 * 대체 지도 — 카카오 키가 없을 때
 * 도로는 없지만 공장·현장·차량의 상대 위치와 경로 모양은 그대로 보인다.
 * ======================================================================== */

function FallbackMap({
  markers,
  paths,
  reason,
}: {
  markers: MapMarker[];
  paths: MapPath[];
  reason: 'nokey' | 'sdk';
}) {
  const pts = [
    ...markers.map((m) => [m.lat, m.lng] as [number, number]),
    ...paths.flatMap((p) => p.points),
  ];

  const lats = pts.map((p) => p[0]);
  const lngs = pts.map((p) => p[1]);
  const minLat = Math.min(...lats, 37.0);
  const maxLat = Math.max(...lats, 37.45);
  const minLng = Math.min(...lngs, 126.8);
  const maxLng = Math.max(...lngs, 127.5);

  const pad = 0.06;
  const W = 100;
  const H = 100;
  const x = (lng: number) => ((lng - minLng) / (maxLng - minLng || 1)) * (W * (1 - 2 * pad)) + W * pad;
  // 위도는 위가 큰 값이므로 뒤집는다
  const y = (lat: number) => (1 - (lat - minLat) / (maxLat - minLat || 1)) * (H * (1 - 2 * pad)) + H * pad;

  return (
    <div className={s.fallback}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        <rect width="100" height="100" fill="#e9e7e2" />
        {[20, 40, 60, 80].map((g) => (
          <g key={g} stroke="#d6d3cd" strokeWidth="0.2">
            <line x1={g} y1="0" x2={g} y2="100" />
            <line x1="0" y1={g} x2="100" y2={g} />
          </g>
        ))}
        {paths.map((p) => (
          <polyline
            key={p.id}
            points={p.points.map(([lat, lng]) => `${x(lng)},${y(lat)}`).join(' ')}
            fill="none"
            stroke={p.emphasis ? '#8A5A3C' : '#8E8C86'}
            strokeWidth={p.emphasis ? 0.9 : 0.5}
            strokeOpacity={p.emphasis ? 0.9 : 0.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {markers.map((m) => (
          <g key={m.id}>
            <circle
              cx={x(m.lng)}
              cy={y(m.lat)}
              r={m.kind === 'truck' ? 1.4 : 1.1}
              fill={toneColor(m)}
              stroke="#2E2E2C"
              strokeWidth="0.25"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
      </svg>

      {/* 마커 이름은 SVG 밖에 HTML 로 올려 글자 크기가 찌그러지지 않게 한다 */}
      {markers.map((m) => (
        <div
          key={m.id}
          className="rmc-marker"
          data-kind={m.kind}
          data-tone={m.tone ?? 'muted'}
          data-selected={m.selected ? '1' : undefined}
          data-clickable={m.onClick ? '1' : undefined}
          onClick={m.onClick}
          style={{
            position: 'absolute',
            left: `${x(m.lng)}%`,
            top: `${y(m.lat)}%`,
            transform: 'translate(-50%, -140%)',
          }}
        >
          <span className="dot" />
          {m.label}
        </div>
      ))}

      <p className={s.fallbackNote}>
        {reason === 'nokey' ? (
          <>
            카카오맵 키가 없어 <strong>대체 지도</strong>로 표시했습니다. 실제 지도를 쓰려면{' '}
            <code>.env.local</code> 에 <code>NEXT_PUBLIC_KAKAO_JS_KEY</code> 를 넣고, 카카오
            Developers 에서 <strong>[카카오맵] &gt; [사용 설정] 상태 ON</strong> 과{' '}
            <strong>[앱] &gt; [플랫폼 키] → JavaScript 키 → JavaScript SDK 도메인</strong> 등록(
            <code>http://localhost:3000</code>)을 하세요. 자세한 순서는 <code>/setup</code> 에
            있습니다.
          </>
        ) : (
          <>
            카카오맵 SDK 를 불러오지 못했습니다. JavaScript 키와 <strong>도메인 등록</strong>을
            확인하세요. 지금은 대체 지도로 표시합니다.
          </>
        )}
      </p>
    </div>
  );
}

const TONE_COLOR: Record<MarkerTone, string> = {
  ok: '#4A6B4F',
  warn: '#A8752C',
  bad: '#9B3D33',
  accent: '#8A5A3C',
  muted: '#8E8C86',
};

const toneColor = (m: MapMarker) =>
  m.kind === 'truck' ? '#2E2E2C' : m.kind === 'site' ? '#8A5A3C' : TONE_COLOR[m.tone ?? 'muted'];
