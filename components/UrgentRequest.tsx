'use client';

/**
 * 긴급 배차 요청 — 현장이 타설 공백을 발견했을 때 누른다.
 *
 * 보통 주문(/site/order)과 다른 점은 셋뿐이다.
 *   ① 타설 시각이 '지금'이다 — 고를 것이 없다
 *   ② 사양은 지금 붓고 있는 것과 같아야 한다 — 고르면 안 된다
 *   ③ 왜 급한지 이유가 붙어서 공장 화면 맨 위로 올라간다
 * 그래서 입력은 대수와 사유 둘뿐이고, 나머지는 진행 중인 주문에서 가져온다.
 *
 * 공장 순서는 이동시간이 짧은 순이다. 긴급에서는 값보다 도착이 먼저다.
 * 판정(사양·물량·시간)은 보통 주문과 같은 PourRules 를 쓴다 — 급하다고 해서
 * 제한시간을 넘겨서 보내면 그게 더 큰 사고다.
 */

import { useEffect, useMemo, useState } from 'react';
import { Alert, Empty, Panel, Row, Tag } from './ui';
import { duration, failure, m3 } from '@/lib/format';
import {
  DEFAULT_POUR_SETTINGS,
  PourRules,
  TRUCK_CAPACITY_M3,
  specText,
} from '@/lib/rules';
import { getRoutesToSite, type RouteResult } from '@/lib/services/route';
import { createOrder } from '@/lib/store';
import { useDb } from '@/lib/store/hooks';
import type { Order, Site } from '@/lib/types';

interface Props {
  site: Site;
  /** 지금 진행 중인 주문 — 사양·온도·펌프 속도를 여기서 가져온다 */
  basis: Order;
  /** 기본 요청 대수 */
  defaultTrucks: number;
  /** 사유 기본값 — 타설 모니터의 문장 */
  defaultReason: string;
}

export default function UrgentRequest({ site, basis, defaultTrucks, defaultReason }: Props) {
  const db = useDb();
  const [open, setOpen] = useState(false);
  const [trucks, setTrucks] = useState(Math.max(1, defaultTrucks));
  const [reason, setReason] = useState(defaultReason);
  const [routes, setRoutes] = useState<Map<string, RouteResult>>(new Map());
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const volumeM3 = trucks * TRUCK_CAPACITY_M3;

  // 펼칠 때만 길찾기를 부른다 — 공장 12곳이면 요청이 12번이다
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    getRoutesToSite(db.plants, site, Date.now())
      .then((r) => alive && setRoutes(r))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, db.plants, site]);

  const allowedMin = PourRules.allowedTravelMinutes(basis.tempC, DEFAULT_POUR_SETTINGS);

  /** 이동시간이 짧은 순. 보낼 수 없는 공장은 아래로 내리되 이유를 보여 준다. */
  const rated = useMemo(() => {
    return db.plants
      .map((plant) => {
        const route = routes.get(plant.id);
        const supply = PourRules.judgeSupply(plant, volumeM3, basis.spec);
        const travel = route ? PourRules.judgeTravel(route.minutes, allowedMin) : null;
        return {
          plant,
          route,
          supply,
          travel,
          level: PourRules.worst(supply.level, travel?.level ?? 'ok'),
        };
      })
      .sort((a, b) => {
        const rank = { ok: 0, warn: 1, bad: 2 } as const;
        return rank[a.level] - rank[b.level] || (a.route?.minutes ?? 999) - (b.route?.minutes ?? 999);
      });
  }, [db.plants, routes, volumeM3, basis.spec, allowedMin]);

  async function send(plantId: string, plantName: string) {
    setSending(plantId);
    setError(null);
    try {
      await createOrder({
        siteId: site.id,
        plantId,
        spec: basis.spec,
        volumeM3,
        // 긴급은 '지금 붓는다' — 타설 시각을 고르게 하지 않는다
        pourStartAt: Date.now(),
        pumpRate: basis.pumpRate,
        tempC: basis.tempC,
        urgent: true,
        urgentReason: reason.trim() || '현장 요청',
      });
      setSentTo(plantName);
      setOpen(false);
    } catch (e) {
      setError(failure(e, '긴급 요청을 보내지 못했습니다.'));
    } finally {
      setSending(null);
    }
  }

  if (sentTo && !open) {
    return (
      <Panel style={{ borderWidth: 2, borderColor: 'var(--color-ok)' }}>
        <Alert tone="ok" title={`${sentTo} 에 긴급 요청을 보냈습니다`}>
          공장이 수락하면 배송 추적에 뜹니다. 급한 건이니 전화로도 한 번 확인하세요 —{' '}
          {db.plants.find((p) => p.name === sentTo)?.phone ?? ''}
        </Alert>
        <button
          type="button"
          className="btn btn-outline btn-sm btn-block"
          style={{ marginTop: 12 }}
          onClick={() => {
            setSentTo(null);
            setOpen(true);
          }}
        >
          한 대 더 요청하기
        </button>
      </Panel>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-primary btn-block"
        style={{ marginTop: 12 }}
        onClick={() => setOpen(true)}
      >
        긴급 배차 요청
      </button>
    );
  }

  return (
    <Panel
      title="긴급 배차 요청"
      aside={<Tag tone="bad">지금 출발</Tag>}
      style={{ borderWidth: 2, borderColor: 'var(--color-rust)' }}
    >
      <Row label="사양">{specText(basis.spec)}</Row>
      <Row label="외기온도">
        {basis.tempC}℃ · 허용 이동시간 {duration(allowedMin)}
      </Row>

      <label className="field" style={{ marginTop: 12 }}>
        <span className="label">필요 대수 ({m3(volumeM3)})</span>
        <input
          type="number"
          className="input"
          min={1}
          max={10}
          value={trucks}
          onChange={(e) => setTrucks(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
        />
      </label>

      <label className="field">
        <span className="label">사유 — 공장 화면에 그대로 보입니다</span>
        <textarea
          className="input"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ resize: 'vertical' }}
        />
      </label>

      {error && (
        <p style={{ fontSize: '0.82rem', color: 'var(--color-bad)', margin: '0 0 8px' }}>{error}</p>
      )}

      <p style={{ fontSize: '0.82rem', color: 'var(--color-concrete-wet)', margin: '4px 0 10px' }}>
        이동시간이 짧은 순입니다. 급해도 <strong>허용 이동시간</strong>을 넘는 공장은 보내면
        안 됩니다 — 도착해도 못 붓습니다.
      </p>

      {loading ? (
        <Empty>공장별 이동시간을 계산하는 중…</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rated.slice(0, 5).map((r) => (
            <div
              key={r.plant.id}
              style={{
                padding: 10,
                background: 'var(--color-paper)',
                border: '1px solid',
                borderColor: r.level === 'ok' ? 'var(--color-line-strong)' : 'var(--color-line)',
                borderRadius: 'var(--radius-sharp)',
                opacity: r.level === 'bad' ? 0.65 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <strong style={{ fontSize: '0.88rem' }}>{r.plant.name}</strong>
                <span style={{ marginLeft: 'auto' }}>
                  <Tag tone={r.level}>
                    {r.route ? `${r.route.minutes}분` : '계산 중'}
                  </Tag>
                </span>
              </div>
              <p
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--color-concrete-mid)',
                  margin: '0 0 8px',
                }}
              >
                {r.supply.label}
                {r.travel ? ` · ${r.travel.label}` : ''}
                {r.route ? ` · ${r.route.distanceKm}km` : ''}
                {r.route?.source === 'approx' ? ' · 근사값' : ''}
              </p>
              <button
                type="button"
                className={`btn btn-sm btn-block ${r.level === 'bad' ? 'btn-outline' : 'btn-primary'}`}
                disabled={r.level === 'bad' || sending != null}
                onClick={() => void send(r.plant.id, r.plant.name)}
              >
                {sending === r.plant.id
                  ? '보내는 중…'
                  : r.level === 'bad'
                    ? '보낼 수 없음'
                    : `${r.plant.name.replace(/레미콘.*/, '레미콘')} 에 요청`}
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className="btn btn-ghost btn-sm btn-block"
        style={{ marginTop: 10 }}
        onClick={() => setOpen(false)}
      >
        닫기
      </button>
    </Panel>
  );
}
