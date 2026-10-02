'use client';

/**
 * 카카오맵. 현장·공장·차량 마커와 경로 선을 그린다.
 *
 * 카메라 규칙이 이 파일의 핵심이다.
 *  · 처음 한 번, 그리고 "보여 줄 대상이 바뀔 때"만 전체가 보이도록 맞춘다.
 *  · 사용자가 지도를 끌거나 확대한 뒤에는 카메라를 자동으로 건드리지 않는다.
 *    예전에는 추적 화면이 1초마다 마커 배열을 새로 넘겼고 그때마다 setBounds 를
 *    불렀다. 그래서 확대를 해도 1초 뒤 원래 배율로 되돌아갔다.
 *  · follow 를 주면 네비게이션처럼 그 좌표를 계속 화면 가운데에 둔다.
 *
 * 마커도 매번 지웠다 다시 만들지 않는다. 같은 id 는 같은 오버레이를 재사용하고
 * 좌표만 옮긴다. 그래야 깜빡이지 않고, 1초 간격으로 오는 좌표 사이를 메워
 * 차가 실제로 굴러가는 것처럼 보인다.
 *
 * NEXT_PUBLIC_KAKAO_JS_KEY 가 없으면 좌표를 그대로 평면에 찍는 대체 지도로 떨어진다.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KakaoCustomOverlay, KakaoMap as KMap, KakaoPolyline } from './kakao.d';
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
  /** 진행 방향(도, 북 0). 주면 점 대신 화살표가 되어 그 방향을 가리킨다 */
  heading?: number;
}

export interface MapPath {
  id: string;
  points: [number, number][];
  /** 진한 선(추천 경로) / 옅은 선(참고) */
  emphasis?: boolean;
  /** 이미 지나온 구간 — 회색으로 깔아 둔다 */
  dim?: boolean;
}

interface Props {
  markers: MapMarker[];
  paths?: MapPath[];
  height?: number;
  /** 주면 전체 맞춤 대신 이 좌표를 중심에 둔다. 값이 바뀔 때만 다시 옮긴다 */
  center?: { lat: number; lng: number };
  level?: number;
  /**
   * 지도를 눌러 좌표를 고르게 한다 (현장·공장 등록).
   * 주면 커서가 십자로 바뀌고, 누른 지점의 위도·경도를 돌려준다.
   */
  onPick?: (at: { lat: number; lng: number }) => void;
  /**
   * 네비게이션 모드. 이 좌표를 계속 화면 가운데에 둔다.
   * 사용자가 지도를 끌면 따라가기가 풀리고 "내 차 따라가기" 단추가 뜬다.
   */
  follow?: { lat: number; lng: number } | null;
  /** 네비게이션 모드의 확대 수준 (작을수록 가깝다) */
  followLevel?: number;
}

const SDK_ID = 'kakao-maps-sdk';

/**
 * 좌표를 한 번 받을 때마다 이만큼에 걸쳐 미끄러지듯 옮긴다.
 * 화면이 1초마다 좌표를 주므로 그보다 조금 짧게 잡아 다음 좌표 전에 자리를 잡는다.
 */
const GLIDE_MS = 900;

export default function KakaoMap({
  markers,
  paths = [],
  height = 360,
  center,
  level,
  onPick,
  follow,
  followLevel = 4,
}: Props) {
  const key = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KMap | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>(
    key ? 'loading' : 'failed',
  );

  /** 사용자가 지도를 직접 움직였나 — 그 뒤로는 카메라를 자동으로 건드리지 않는다 */
  const [userMoved, setUserMoved] = useState(false);
  /** 네비 따라가기가 사용자 조작으로 풀렸나 */
  const [followBroken, setFollowBroken] = useState(false);

  // 우리가 부른 카메라 이동이 "사용자 조작"으로 오인되지 않게 가리는 시간 창
  const selfMoveUntil = useRef(0);
  const markersRef = useRef(new Map<string, MarkerEntry>());
  const linesRef = useRef(new Map<string, LineEntry>());
  const fitSigRef = useRef('');
  const centerSigRef = useRef('');
  const followRef = useRef<{ lat: number; lng: number } | null>(null);
  const followOnRef = useRef(false);

  followRef.current = follow ?? null;
  followOnRef.current = !!follow && !followBroken;

  /** 보여 줄 대상이 바뀌었는지 — 좌표가 아니라 "무엇이 떠 있는지"로 잰다 */
  const fitSig = useMemo(
    () =>
      markers
        .map((m) => m.id)
        .sort()
        .join('|') +
      '/' +
      paths
        .filter((p) => p.points.length > 1)
        .map((p) => p.id)
        .sort()
        .join('|'),
    [markers, paths],
  );

  // ── SDK 로드 ──
  useEffect(() => {
    if (!key) return;

    let cancelled = false;

    const init = () => {
      if (cancelled || !boxRef.current || !window.kakao) return;
      window.kakao.maps.load(() => {
        if (cancelled || !boxRef.current || !window.kakao) return;
        const kakao = window.kakao;
        const map = new kakao.maps.Map(boxRef.current, {
          center: new kakao.maps.LatLng(center?.lat ?? 37.24, center?.lng ?? 127.08),
          level: level ?? 9,
        });
        // 휠·손가락 말고도 확대할 수단을 준다
        try {
          map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
        } catch {
          /* 구버전 SDK 에는 없을 수 있다 — 지도 자체는 그대로 쓴다 */
        }
        mapRef.current = map;
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
    // center·level 은 최초 한 번만 쓴다. 이후 갱신은 아래 카메라 effect 가 맡는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // ── 사용자가 지도를 움직였는지 지켜본다 ──
  useEffect(() => {
    const map = mapRef.current;
    const kakao = window.kakao;
    if (status !== 'ready' || !map || !kakao) return;

    // 끌기는 언제나 사람이 한 것이다
    const onDrag = () => {
      setUserMoved(true);
      if (followOnRef.current) setFollowBroken(true);
    };
    // 확대는 우리가 setBounds 로 바꾼 것일 수도 있어 시간 창으로 가린다
    const onZoom = () => {
      if (Date.now() < selfMoveUntil.current) return;
      setUserMoved(true);
    };

    kakao.maps.event.addListener(map, 'dragstart', onDrag);
    kakao.maps.event.addListener(map, 'zoom_changed', onZoom);
    return () => {
      kakao.maps.event.removeListener(map, 'dragstart', onDrag);
      kakao.maps.event.removeListener(map, 'zoom_changed', onZoom);
    };
  }, [status]);

  // ── 지도를 눌러 좌표 고르기 ──
  useEffect(() => {
    const map = mapRef.current;
    const kakao = window.kakao;
    if (status !== 'ready' || !map || !kakao || !onPick) return;

    const handler = (e: { latLng?: { getLat(): number; getLng(): number } }) => {
      if (!e.latLng) return;
      onPick({ lat: e.latLng.getLat(), lng: e.latLng.getLng() });
    };
    kakao.maps.event.addListener(map, 'click', handler);
    return () => kakao.maps.event.removeListener(map, 'click', handler);
  }, [status, onPick]);

  // ── 마커·경로 갱신 (지우지 않고 옮긴다) ──
  useEffect(() => {
    const map = mapRef.current;
    const kakao = window.kakao;
    if (status !== 'ready' || !map || !kakao) return;

    // 경로
    const liveLines = new Set<string>();
    for (const p of paths) {
      if (p.points.length < 2) continue;
      liveLines.add(p.id);
      const sig = pathSig(p);
      const found = linesRef.current.get(p.id);
      if (found) {
        if (found.sig !== sig) {
          found.line.setPath(p.points.map(([la, ln]) => new kakao.maps.LatLng(la, ln)));
          found.line.setOptions(lineStyle(p));
          found.sig = sig;
        }
      } else {
        const line = new kakao.maps.Polyline({
          path: p.points.map(([la, ln]) => new kakao.maps.LatLng(la, ln)),
          ...lineStyle(p),
          map,
        });
        linesRef.current.set(p.id, { line, sig });
      }
    }
    for (const [id, entry] of linesRef.current) {
      if (!liveLines.has(id)) {
        entry.line.setMap(null);
        linesRef.current.delete(id);
      }
    }

    // 마커
    const liveMarkers = new Set<string>();
    const t = now();
    for (const m of markers) {
      liveMarkers.add(m.id);
      const found = markersRef.current.get(m.id);
      if (found) {
        paintMarker(found.el, m);
        found.onClick = m.onClick;
        if (found.to[0] !== m.lat || found.to[1] !== m.lng) {
          // 지금 눈에 보이는 자리에서 이어서 움직인다 — 되감기지 않게
          found.from = lerpAt(found, t);
          found.to = [m.lat, m.lng];
          found.t0 = t;
          // 탭이 뒤에 있으면 requestAnimationFrame 이 아예 돌지 않는다.
          // 보간을 포기하고 바로 목표 좌표로 간다 — 안 그러면 돌아왔을 때
          // 차가 한참 전 자리에 멈춰 있다.
          if (isHidden()) found.t0 = 0;
        }
        // 위치를 여기서도 한 번 적는다. 애니메이션 루프에만 맡기면 그 루프가
        // 멈춘 환경에서는 마커가 처음 자리에 못 박힌다.
        const [la, ln] = lerpAt(found, t);
        found.overlay.setPosition(new kakao.maps.LatLng(la, ln));
      } else {
        const el = document.createElement('div');
        const entry: MarkerEntry = {
          el,
          overlay: null as unknown as KakaoCustomOverlay,
          from: [m.lat, m.lng],
          to: [m.lat, m.lng],
          t0: 0,
          onClick: m.onClick,
        };
        paintMarker(el, m);
        el.addEventListener('click', () => entry.onClick?.());
        entry.overlay = new kakao.maps.CustomOverlay({
          position: new kakao.maps.LatLng(m.lat, m.lng),
          content: el,
          yAnchor: 1,
          zIndex: m.kind === 'truck' ? 30 : m.selected ? 20 : 10,
          clickable: true,
          map,
        });
        markersRef.current.set(m.id, entry);
      }
    }
    for (const [id, entry] of markersRef.current) {
      if (!liveMarkers.has(id)) {
        entry.overlay.setMap(null);
        markersRef.current.delete(id);
      }
    }
  }, [status, markers, paths]);

  // ── 카메라 ──
  useEffect(() => {
    const map = mapRef.current;
    const kakao = window.kakao;
    if (status !== 'ready' || !map || !kakao) return;

    // 우리가 움직이는 동안의 zoom_changed 는 사용자 조작이 아니다
    const quietly = (fn: () => void) => {
      selfMoveUntil.current = Date.now() + 500;
      fn();
    };

    if (follow) {
      // 네비 모드의 확대 수준은 처음 한 번만 맞춘다. 그 뒤로는 기사가 정한다
      if (fitSigRef.current !== 'follow') {
        fitSigRef.current = 'follow';
        quietly(() => map.setLevel(followLevel));
      }
      /**
       * 중심 맞추기를 애니메이션 루프에만 맡기지 않는다. 그 루프는 화면이
       * 가려지면 멈추고, 브라우저가 프레임을 아끼면 몇 초씩 건너뛴다. 그 사이
       * 지도는 기본 좌표를 보고 있어 차도 길도 없는 빈 지도가 된다.
       *
       * 두 곳이 같은 식(아래 centerOnFollow)을 쓰므로 번갈아 불려도 값이 같다.
       * 서로 다른 좌표를 넣으면 화면이 떨린다.
       */
      if (!followBroken) centerOnFollow(map, markersRef.current, follow);
      return;
    }

    if (center) {
      const sig = `${center.lat.toFixed(6)},${center.lng.toFixed(6)},${level ?? ''}`;
      if (centerSigRef.current !== sig) {
        centerSigRef.current = sig;
        quietly(() => {
          map.setCenter(new kakao.maps.LatLng(center.lat, center.lng));
          if (level) map.setLevel(level);
        });
      }
      return;
    }

    // 사용자가 지도를 만진 뒤에는 마음대로 되돌리지 않는다.
    // 다시 보고 싶으면 "전체 보기" 단추가 있다.
    if (userMoved || markers.length === 0 || fitSigRef.current === fitSig) return;
    fitSigRef.current = fitSig;
    quietly(() => fitAll(map, markers, paths));
  }, [status, fitSig, userMoved, center, level, follow, followBroken, followLevel, markers, paths]);

  // ── 미끄러지는 이동 + 네비 따라가기 ──
  useEffect(() => {
    if (status !== 'ready') return;
    const kakao = window.kakao;
    if (!kakao) return;

    let raf = 0;
    const tick = () => {
      const map = mapRef.current;
      if (map) {
        const t = now();

        for (const entry of markersRef.current.values()) {
          const [la, ln] = lerpAt(entry, t);
          entry.overlay.setPosition(new kakao.maps.LatLng(la, ln));
        }

        // 네비 모드 — 차가 움직인 만큼 화면도 같이 흐른다
        if (followOnRef.current && followRef.current) {
          centerOnFollow(map, markersRef.current, followRef.current, t);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status]);

  // ── 화면을 떠날 때 지도에서 떼어 낸다 ──
  useEffect(() => {
    const marks = markersRef.current;
    const lines = linesRef.current;
    return () => {
      for (const e of marks.values()) e.overlay?.setMap(null);
      for (const e of lines.values()) e.line.setMap(null);
      marks.clear();
      lines.clear();
    };
  }, []);

  const showFitAll = status === 'ready' && userMoved && !center && !follow;
  const showResume = status === 'ready' && !!follow && followBroken;

  return (
    <div className={s.box} style={{ height, cursor: onPick ? 'crosshair' : undefined }}>
      {key ? (
        <>
          <div ref={boxRef} className={s.canvas} />
          {status === 'loading' && <div className={s.loading}>지도 불러오는 중…</div>}
          {status === 'failed' && (
            <FallbackMap markers={markers} paths={paths} reason="sdk" onPick={onPick} />
          )}
          {showFitAll && (
            <button
              type="button"
              className={s.camBtn}
              onClick={() => {
                const map = mapRef.current;
                if (!map) return;
                selfMoveUntil.current = Date.now() + 500;
                fitAll(map, markers, paths);
                setUserMoved(false);
              }}
            >
              전체 보기
            </button>
          )}
          {showResume && (
            <button
              type="button"
              className={s.camBtn}
              onClick={() => {
                setFollowBroken(false);
                setUserMoved(false);
              }}
            >
              내 차 따라가기
            </button>
          )}
        </>
      ) : (
        <FallbackMap markers={markers} paths={paths} reason="nokey" onPick={onPick} />
      )}
    </div>
  );
}

/* ==========================================================================
 * 카메라·마커 도우미
 * ======================================================================== */

interface MarkerEntry {
  el: HTMLElement;
  overlay: KakaoCustomOverlay;
  /** 미끄러짐 시작 좌표 */
  from: [number, number];
  /** 미끄러짐 끝 좌표 */
  to: [number, number];
  t0: number;
  onClick?: () => void;
}

interface LineEntry {
  line: KakaoPolyline;
  sig: string;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** 화면이 가려져 requestAnimationFrame 이 멈추는 상황인가 */
const isHidden = () => typeof document !== 'undefined' && document.hidden;

/** from → to 사이를 GLIDE_MS 에 걸쳐 지나는 지금 좌표 */
function lerpAt(e: MarkerEntry, t: number): [number, number] {
  if (!e.t0) return e.to;
  const k = Math.min(1, Math.max(0, (t - e.t0) / GLIDE_MS));
  return [e.from[0] + (e.to[0] - e.from[0]) * k, e.from[1] + (e.to[1] - e.from[1]) * k];
}

/**
 * 네비 모드에서 화면 중심을 차에 맞춘다.
 *
 * 따라갈 좌표는 1초마다 들어오지만 마커는 그 사이를 미끄러져 간다. 중심을
 * 들어온 좌표에 맞추면 마커가 중심에서 앞뒤로 흔들리므로, 마커가 지금 그려지는
 * 자리를 그대로 쓴다. 호출하는 두 곳(카메라 effect · 애니메이션 루프)이 이
 * 함수를 함께 쓰는 이유다.
 */
function centerOnFollow(
  map: KMap,
  entries: Map<string, MarkerEntry>,
  at: { lat: number; lng: number },
  t = now(),
) {
  const kakao = window.kakao;
  if (!kakao) return;
  const truck = nearestEntry(entries, at);
  const [la, ln] = truck ? lerpAt(truck, t) : [at.lat, at.lng];
  map.setCenter(new kakao.maps.LatLng(la, ln));
}

/** follow 좌표에 가장 가까운 마커 — 그 마커의 보간 위치를 따라가야 화면이 떨리지 않는다 */
function nearestEntry(entries: Map<string, MarkerEntry>, at: { lat: number; lng: number }) {
  let best: MarkerEntry | null = null;
  let bestD = Infinity;
  for (const e of entries.values()) {
    const d = Math.hypot(e.to[0] - at.lat, e.to[1] - at.lng);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  // 0.5도(약 55km)보다 멀면 다른 마커다 — 그때는 좌표를 그대로 쓴다
  return bestD < 0.5 ? best : null;
}

function fitAll(map: KMap, markers: MapMarker[], paths: MapPath[]) {
  const kakao = window.kakao;
  if (!kakao) return;
  const bounds = new kakao.maps.LatLngBounds();
  for (const m of markers) bounds.extend(new kakao.maps.LatLng(m.lat, m.lng));
  for (const p of paths) {
    for (const [la, ln] of p.points) bounds.extend(new kakao.maps.LatLng(la, ln));
  }
  map.setBounds(bounds, 40, 40, 40, 40);
}

function lineStyle(p: MapPath) {
  if (p.dim) {
    return { strokeWeight: 6, strokeColor: '#B9B5AD', strokeOpacity: 0.65, strokeStyle: 'solid' };
  }
  return {
    strokeWeight: p.emphasis ? 6 : 3,
    strokeColor: p.emphasis ? '#8A5A3C' : '#8E8C86',
    strokeOpacity: p.emphasis ? 0.92 : 0.5,
    strokeStyle: 'solid',
  };
}

/** 선이 실제로 바뀌었는지 싸게 가린다 — 좌표 수백 개를 매초 다시 만들지 않으려고 */
function pathSig(p: MapPath) {
  const n = p.points.length;
  const a = p.points[0];
  const b = p.points[n - 1];
  const ends = `${a[0].toFixed(5)},${a[1].toFixed(5)}>${b[0].toFixed(5)},${b[1].toFixed(5)}`;
  return `${n}:${ends}:${p.emphasis ? 1 : 0}${p.dim ? 'd' : ''}`;
}

/** 마커 DOM 을 지금 상태에 맞게 칠한다. 요소는 그대로 두고 속성만 갈아 끼운다 */
function paintMarker(el: HTMLElement, m: MapMarker) {
  el.className = 'rmc-marker';
  el.dataset.kind = m.kind;
  el.dataset.tone = m.tone ?? 'muted';
  if (m.selected) el.dataset.selected = '1';
  else delete el.dataset.selected;
  if (m.onClick) el.dataset.clickable = '1';
  else delete el.dataset.clickable;

  if (m.heading != null) {
    el.dataset.heading = '1';
    el.style.setProperty('--rmc-heading', `${Math.round(m.heading)}deg`);
  } else {
    delete el.dataset.heading;
    el.style.removeProperty('--rmc-heading');
  }

  let dot = el.querySelector<HTMLElement>('.dot');
  if (!dot) {
    dot = document.createElement('span');
    dot.className = 'dot';
    el.appendChild(dot);
  }
  let text = el.querySelector<HTMLElement>('.rmc-label');
  if (!text) {
    text = document.createElement('span');
    text.className = 'rmc-label';
    el.appendChild(text);
  }
  if (text.textContent !== m.label) text.textContent = m.label;
}

/* ==========================================================================
 * 대체 지도 — 카카오 키가 없을 때
 * 도로는 없지만 공장·현장·차량의 상대 위치와 경로 모양은 그대로 보인다.
 * ======================================================================== */

function FallbackMap({
  markers,
  paths,
  reason,
  onPick,
}: {
  markers: MapMarker[];
  paths: MapPath[];
  reason: 'nokey' | 'sdk';
  onPick?: (at: { lat: number; lng: number }) => void;
}) {
  /**
   * 테두리는 움직이지 않는 것(현장·공장·경로)으로만 잡는다.
   * 차량까지 넣으면 차가 갈 때마다 그림 전체가 늘었다 줄었다 해서,
   * 정작 차는 제자리에 있는 것처럼 보인다.
   */
  const pts = [
    ...markers.filter((m) => m.kind !== 'truck').map((m) => [m.lat, m.lng] as [number, number]),
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

  /**
   * 대체 지도에서도 좌표를 고를 수 있어야 한다 — 카카오 키가 없는 조원도 현장을
   * 등록해 봐야 하기 때문이다. 화면 좌표를 위도·경도로 되돌린다(위에서 쓴 식의 역).
   */
  const pickFromSvg = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onPick) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const py = ((e.clientY - r.top) / r.height) * H;
    const fx = (px - W * pad) / (W * (1 - 2 * pad));
    const fy = (py - H * pad) / (H * (1 - 2 * pad));
    onPick({
      lat: minLat + (1 - fy) * (maxLat - minLat || 1),
      lng: minLng + fx * (maxLng - minLng || 1),
    });
  };

  return (
    <div className={s.fallback}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%', cursor: onPick ? 'crosshair' : undefined }}
        onClick={onPick ? pickFromSvg : undefined}
      >
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
            stroke={p.dim ? '#B9B5AD' : p.emphasis ? '#8A5A3C' : '#8E8C86'}
            strokeWidth={p.dim ? 1.1 : p.emphasis ? 0.9 : 0.5}
            strokeOpacity={p.dim ? 0.65 : p.emphasis ? 0.9 : 0.5}
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
          data-heading={m.heading != null ? '1' : undefined}
          onClick={m.onClick}
          style={
            {
              position: 'absolute',
              left: `${x(m.lng)}%`,
              top: `${y(m.lat)}%`,
              transform: 'translate(-50%, -140%)',
              // 차량은 1초마다 좌표가 바뀐다 — 그 사이를 CSS 가 메워 준다
              transition: m.kind === 'truck' ? 'left .9s linear, top .9s linear' : undefined,
              '--rmc-heading': m.heading != null ? `${Math.round(m.heading)}deg` : undefined,
            } as React.CSSProperties
          }
        >
          <span className="dot" />
          <span className="rmc-label">{m.label}</span>
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
