'use client';

/**
 * 위치 고르기 — 현장·공장 등록에서 같이 쓴다.
 *
 * 위도·경도를 사람에게 물어볼 수는 없다. 두 가지 길을 둔다.
 *   ① 주소·이름으로 검색 (카카오 로컬)
 *   ② 지도를 눌러 직접 찍기 — 신축현장은 주소가 아직 없는 일이 흔하다
 *
 * 찍은 자리가 맞는지 눈으로 확인할 수 있게 지도에 바로 핀을 세운다.
 * 이동시간 계산이 이 좌표로 돌아가므로, 몇백 미터만 틀려도 배분이 어긋난다.
 */

import { useEffect, useRef, useState } from 'react';
import KakaoMap from './KakaoMap';
import { Empty, Tag } from './ui';
import type { GeocodeHit, GeocodeResponse } from '@/app/api/geocode/route';

export interface PickedLocation {
  address: string;
  lat: number;
  lng: number;
}

/** [가정] 검색 자동 호출 지연 — 한 글자마다 부르면 카카오 한도를 금방 쓴다 */
const DEBOUNCE_MS = 450;

/** 경기 남부 — 아무것도 안 골랐을 때 지도의 처음 위치 */
const DEFAULT_CENTER = { lat: 37.24, lng: 127.08 };

export default function LocationPicker({
  value,
  onChange,
  label = '위치',
  height = 260,
}: {
  value: PickedLocation | null;
  onChange: (at: PickedLocation) => void;
  label?: string;
  height?: number;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<number | null>(null);

  // 입력이 멎으면 찾는다
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setHits([]);
      setNote(null);
      return;
    }

    let alive = true;
    setSearching(true);
    timer.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(query.trim())}`);
        const data = (await res.json()) as GeocodeResponse;
        if (!alive) return;
        setHits(data.hits);
        setNote(data.note ?? null);
      } catch {
        if (alive) setNote('주소를 찾지 못했습니다. 지도에서 직접 찍어 주세요.');
      } finally {
        if (alive) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      alive = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [query]);

  const pickHit = (h: GeocodeHit) => {
    onChange({ address: h.address || h.title, lat: h.lat, lng: h.lng });
    setHits([]);
    setQuery('');
  };

  return (
    <div className="field">
      <span className="label">{label}</span>

      <input
        className="input"
        type="search"
        value={query}
        placeholder="주소나 현장 이름으로 찾기 — 예) 용인시 기흥구 서천동"
        aria-label={`${label} 검색`}
        onChange={(e) => setQuery(e.target.value)}
      />

      {searching && (
        <p style={{ fontSize: '0.78rem', color: 'var(--color-concrete-mid)', margin: '6px 0 0' }}>
          찾는 중…
        </p>
      )}

      {note && !searching && (
        <p style={{ fontSize: '0.78rem', color: 'var(--color-warn)', margin: '6px 0 0' }}>{note}</p>
      )}

      {hits.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            margin: '8px 0 0',
            padding: 0,
            border: '1px solid var(--color-line-strong)',
            borderRadius: 'var(--radius-sharp)',
            overflow: 'hidden',
          }}
        >
          {hits.map((h, i) => (
            <li key={`${h.lat},${h.lng},${i}`}>
              <button
                type="button"
                onClick={() => pickHit(h)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  background: 'var(--color-card)',
                  border: 'none',
                  borderTop: i === 0 ? 'none' : '1px solid var(--color-line)',
                  cursor: 'pointer',
                }}
              >
                <strong style={{ fontSize: '0.88rem', display: 'block' }}>{h.title}</strong>
                <span style={{ fontSize: '0.78rem', color: 'var(--color-concrete-mid)' }}>
                  {h.address || '주소 없음'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: 10 }}>
        <KakaoMap
          height={height}
          center={value ?? DEFAULT_CENTER}
          level={value ? 4 : 9}
          markers={
            value
              ? [
                  {
                    id: 'picked',
                    lat: value.lat,
                    lng: value.lng,
                    kind: 'site',
                    label: '여기',
                    tone: 'accent',
                    selected: true,
                  },
                ]
              : []
          }
          onPick={(at) =>
            onChange({
              // 지도를 직접 찍었으면 주소는 사람이 적는다 — 역지오코딩까지는 하지 않는다
              address: value?.address ?? '',
              lat: Math.round(at.lat * 1e6) / 1e6,
              lng: Math.round(at.lng * 1e6) / 1e6,
            })
          }
        />
      </div>

      <p style={{ fontSize: '0.78rem', color: 'var(--color-concrete-mid)', margin: '8px 0 0' }}>
        지도를 눌러 직접 찍을 수도 있습니다. 신축현장은 아직 주소가 없는 경우가 많습니다.
      </p>

      {value ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            marginTop: 8,
            padding: '8px 12px',
            background: 'var(--color-paper)',
            border: '1px solid var(--color-line)',
            borderRadius: 'var(--radius-sharp)',
          }}
        >
          <Tag tone="ok">위치 지정됨</Tag>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
            {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
          </span>
        </div>
      ) : (
        <Empty>아직 위치를 고르지 않았습니다.</Empty>
      )}
    </div>
  );
}
