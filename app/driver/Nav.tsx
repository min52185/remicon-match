'use client';

/**
 * 기사 네비게이션.
 *
 * 카카오택시처럼 "내가 지금 어디를 지나고 있고 몇 분 남았는지"를 보여 준다.
 * 배차표가 아니라 운전석에서 보는 화면이라, 숫자 세 개(남은 거리·남은 시간·도착)를
 * 가장 크게 두고 나머지는 아래로 내린다.
 *
 * 세 가지를 한다.
 *  1. 지나온 길은 회색, 남은 길은 진한 색으로 갈라 그린다 — 진행이 눈에 보이게
 *  2. 지도를 내 차에 붙여 따라간다 (지도를 끌면 풀리고 단추로 되돌린다)
 *  3. 운행 중에는 지금 위치에서 현장까지의 경로를 1분마다 다시 받는다
 *
 * 3번이 "교통상황 반영"의 실체다. 배차 때 받은 경로는 그 시각의 교통이고,
 * 30분을 달리는 동안 길은 막히기도 뚫리기도 한다. 다시 받지 않으면 화면의
 * 파란 선은 과거를 가리킨다.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import KakaoMap, { type MapMarker, type MapPath } from '@/components/KakaoMap';
import { Stat, StatGrid, Tag } from '@/components/ui';
import { clock, km } from '@/lib/format';
import { headingAt, remainingKm, splitPath } from '@/lib/geo';
import { DeliveryRules } from '@/lib/rules';
import { simClock } from '@/lib/services/clock';
import { getRoute, type RouteResult } from '@/lib/services/route';
import type { Position } from '@/lib/services/tracking';
import type { Delivery, Plant, Site } from '@/lib/types';

/** [가정] 운행 중 경로를 다시 받는 주기. 짧을수록 정확하지만 카카오 호출이 늘어난다 */
const REROUTE_MS = 60_000;

interface Props {
  delivery: Delivery;
  pos: Position;
  site: Site;
  plant?: Plant;
  now: number;
  /** 운행 중인가 — 참이면 따라가기와 경로 재계산이 켜진다 */
  driving: boolean;
  height?: number;
}

export default function Nav({ delivery, pos, site, plant, now, driving, height = 280 }: Props) {
  /**
   * 위치는 1초마다 바뀐다. 이것을 effect 의 의존성에 넣으면 1초마다 타이머가
   * 다시 깔려 재계산이 영영 일어나지 않는다. 그래서 ref 로만 읽는다.
   */
  const posRef = useRef(pos);
  posRef.current = pos;

  const [live, setLive] = useState<(RouteResult & { at: number }) | null>(null);

  useEffect(() => {
    if (!driving) {
      setLive(null);
      return;
    }
    let alive = true;

    const pull = async () => {
      const p = posRef.current;
      const r = await getRoute(
        { lat: p.lat, lng: p.lng },
        { lat: site.lat, lng: site.lng },
        Date.now(),
      );
      // 점 하나짜리 경로는 그릴 수 없다 — 그럴 때는 원래 경로를 계속 쓴다
      // 시각은 시연 시계로 찍는다. 화면의 다른 시각은 전부 그쪽이라,
      // 실제 시계를 섞으면 "27분 뒤 도착인데 기준이 4시간 전" 같은 글이 나온다
      if (alive && r.path.length > 1) setLive({ ...r, at: simClock.now() });
    };

    void pull();
    const id = window.setInterval(() => void pull(), REROUTE_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [driving, site.lat, site.lng]);

  const split = useMemo(
    () => splitPath(delivery.path, pos.progress),
    [delivery.path, pos.progress],
  );

  // 남은 길은 다시 받은 경로가 있으면 그것을 쓴다
  const ahead = live && live.path.length > 1 ? live.path : split.rest;

  const leftKm = live ? live.distanceKm : remainingKm(delivery.path, pos.progress);
  const leftMin = Math.max(0, Math.round((pos.etaAt - now) / 60_000));
  const heading = pos.heading ?? headingAt(delivery.path, pos.progress);
  const traffic = live?.delayReason ?? delivery.delayReason;
  /**
   * arriveAt 은 배차할 때 미리 박히는 "도착 예정 실적"이라 값이 있다고 도착한 것이
   * 아니다. 그걸로 판단했더니 출발도 안 한 차가 도착으로 잡혀 남은 거리·시간이
   * 아예 안 떴다. 판정은 프로젝트가 이미 쓰는 phase 하나로 모은다.
   */
  const phase = DeliveryRules.phase(delivery, now);
  const arrived = phase === 'onsite' || phase === 'done';

  const markers: MapMarker[] = [
    ...(plant && !driving
      ? [
          {
            id: plant.id,
            lat: plant.lat,
            lng: plant.lng,
            kind: 'plant' as const,
            label: plant.name,
            tone: 'muted' as const,
          },
        ]
      : []),
    {
      id: site.id,
      lat: site.lat,
      lng: site.lng,
      kind: 'site' as const,
      label: site.name,
      tone: 'accent' as const,
    },
    ...(arrived
      ? []
      : [
          {
            id: delivery.id,
            lat: pos.lat,
            lng: pos.lng,
            kind: 'truck' as const,
            label: driving ? '내 차' : `내 차 ${clock(delivery.etaCurrentAt)}`,
            tone: 'ok' as const,
            selected: true,
            heading,
          } satisfies MapMarker,
        ]),
  ];

  const paths: MapPath[] = driving
    ? [
        ...(split.done.length > 1 ? [{ id: 'done', points: split.done, dim: true }] : []),
        ...(ahead.length > 1 ? [{ id: 'ahead', points: ahead, emphasis: true }] : []),
      ]
    : delivery.path.length > 1
      ? [{ id: delivery.id, points: delivery.path, emphasis: true }]
      : [];

  return (
    <div style={{ marginBottom: 12 }}>
      {/* 운전석에서 보는 세 숫자 */}
      {!arrived && (
        <div style={{ marginBottom: 10 }}>
          <StatGrid min={96}>
            <Stat label="남은 거리" value={km(leftKm)} />
            <Stat label="남은 시간" value={leftMin} unit="분" tone={leftMin <= 5 ? 'ok' : 'muted'} />
            <Stat label="도착 예상" value={clock(pos.etaAt)} />
          </StatGrid>
        </div>
      )}

      <KakaoMap
        markers={markers}
        paths={paths}
        height={height}
        follow={driving && !arrived ? { lat: pos.lat, lng: pos.lng } : null}
        followLevel={4}
      />

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          margin: '6px 0 0',
          fontSize: '0.76rem',
          color: 'var(--color-concrete-mid)',
        }}
      >
        {traffic ? <Tag tone="warn">{traffic}</Tag> : <Tag tone="ok">지체 구간 없음</Tag>}
        {driving &&
          (live ? (
            <span>
              {live.source === 'kakao' ? '카카오 실시간 경로' : '근사 경로(키 없음)'} ·{' '}
              {clock(live.at)} 기준 {live.minutes}분
            </span>
          ) : (
            <span>경로 받는 중…</span>
          ))}
        {!driving && <span>배차 때 받은 추천 경로입니다. 운행을 시작하면 1분마다 다시 받습니다.</span>}
      </div>

      <p style={{ fontSize: '0.74rem', color: 'var(--color-concrete-mid)', margin: '6px 0 0' }}>
        추천 경로입니다. 실제 운전은 기사 판단이 우선합니다.
      </p>
    </div>
  );
}
