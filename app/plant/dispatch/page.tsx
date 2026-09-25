'use client';

/**
 * 레미콘사 — 배차와 출하 지시.
 *
 * '출하 지시'를 누른 순간이 비비기 시작 시각으로 기록된다. 제한시간(90/120분)은
 * 여기서부터 흐르기 때문에, 이 버튼이 납품서의 기준점이 된다.
 *
 * AI 배분으로 들어온 주문이면 회차별 출하 시각표를 같이 보여 준다.
 */

import { useEffect, useState } from 'react';
import { PlantShell } from '@/components/RoleShells';
import { Empty, MockNotice, Panel, Row, Tag } from '@/components/ui';
import { clock, duration, failure, m3, remaining } from '@/lib/format';
import {
  DeliveryRules,
  MIN,
  PHASE_LABEL,
  PHASE_TONE,
  RULES,
  TRUCK_CAPACITY_M3,
  specText,
} from '@/lib/rules';
import { getRoute, type RouteResult } from '@/lib/services/route';
import {
  deliveriesOfOrder,
  dispatchTruck,
  ordersOfPlant,
  activeDeliveriesOfPlant,
} from '@/lib/store';
import { useDb, useMounted, useNow } from '@/lib/store/hooks';
import type { Order, Plant } from '@/lib/types';

export default function DispatchPage() {
  return (
    <PlantShell
      title="배차 · 출하 지시"
      description="출하 지시를 누른 시각이 비비기 시작으로 기록됩니다."
    >
      {(plant) => <DispatchBody plant={plant} />}
    </PlantShell>
  );
}

function DispatchBody({ plant }: { plant: Plant }) {
  const db = useDb();
  const mounted = useMounted();
  const orders = ordersOfPlant(db, plant.id).filter(
    (o) => o.status === 'accepted' || o.status === 'delivering',
  );

  if (!mounted) return <Empty>불러오는 중…</Empty>;

  return (
    <>
      <MockNotice />
      {orders.length === 0 ? (
        <Panel>
          <Empty>
            배차할 주문이 없습니다.
            <br />
            주문 관리에서 수락하면 여기에 뜹니다.
          </Empty>
        </Panel>
      ) : (
        orders.map((o) => <DispatchCard key={o.id} order={o} plant={plant} />)
      )}
    </>
  );
}

function DispatchCard({ order, plant }: { order: Order; plant: Plant }) {
  const db = useDb();
  const now = useNow(1000);
  const site = db.sites.find((s) => s.id === order.siteId);
  const deliveries = deliveriesOfOrder(db, order.id);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [truckId, setTruckId] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!site) return;
    let alive = true;
    getRoute(plant, site, Date.now()).then((r) => alive && setRoute(r));
    return () => {
      alive = false;
    };
  }, [plant, site]);

  const planItem = db.plans.find((p) => p.id === order.planId)?.items.find((i) => i.plantId === plant.id);

  const dispatched = deliveries.reduce((s, d) => s + d.volumeM3, 0);
  const left = Math.max(0, order.volumeM3 - dispatched);
  const leftTrucks = Math.ceil(left / TRUCK_CAPACITY_M3);
  const nextVolume = Math.min(TRUCK_CAPACITY_M3, left);

  // 지금 운행 중이 아닌 차량만 고를 수 있다
  const busy = new Set(activeDeliveriesOfPlant(db, plant.id).map((d) => d.truckId));
  const free = db.trucks
    .filter((t) => t.plantId === plant.id && !busy.has(t.id))
    // 기사가 맡은 차를 위로 — 그 차로 배차해야 기사 화면에 배송이 뜬다
    .sort((a, b) => Number(!!b.driverId) - Number(!!a.driverId) || a.no - b.no);

  // AI 시각표가 있으면 "다음 회차"의 권장 출하 시각을 알려 준다
  const nextMixStartAt = planItem?.mixStartAts
    .slice()
    .sort((a, b) => a - b)
    .find((_, i) => i === deliveries.length);

  async function send() {
    if (!route || !truckId || left <= 0) return;
    setSending(true);
    setError(null);
    try {
      await dispatchTruck({
        order,
        truckId,
        travelMinutes: route.minutes,
        distanceKm: route.distanceKm,
        path: route.path,
        volumeM3: nextVolume,
        mixStartAt: now,
      });
      setTruckId('');
    } catch (e) {
      setError(failure(e, '출하 지시에 실패했습니다.'));
    } finally {
      setSending(false);
    }
  }

  return (
    <Panel
      title={`${order.code} · ${site?.name ?? ''}`}
      aside={
        left <= 0 ? <Tag tone="ok">전량 출하</Tag> : <Tag tone="accent">{leftTrucks}대 남음</Tag>
      }
    >
      <Row label="사양">{specText(order.spec)}</Row>
      <Row label="주문 물량">{m3(order.volumeM3)}</Row>
      <Row label="출하 완료">
        {m3(dispatched)} / 남은 {m3(left)}
      </Row>
      <Row label="이동시간">
        {route ? `${duration(route.minutes)} · ${route.distanceKm}km` : '계산 중…'}
      </Row>
      <Row label="타설 시작">{clock(order.pourStartAt)}</Row>
      <Row label="제한시간">
        {order.tempC}℃ · 비비기~타설 완료{' '}
        {order.tempC >= RULES.HOT_THRESHOLD_C ? RULES.LIMIT_HOT_MIN : RULES.LIMIT_NORMAL_MIN}분
      </Row>

      {/* AI 시각표 */}
      {planItem && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: 'var(--color-paper)',
            border: '1px solid var(--color-line)',
            borderRadius: 'var(--radius-sharp)',
          }}
        >
          <strong style={{ fontSize: '0.86rem', display: 'block', marginBottom: 6 }}>
            AI 배분 출하 시각표 — {planItem.trucks}대
          </strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {planItem.mixStartAts
              .slice()
              .sort((a, b) => a - b)
              .map((at, i) => {
                const done = i < deliveries.length;
                const isNext = i === deliveries.length;
                return (
                  <span
                    key={i}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.76rem',
                      padding: '3px 7px',
                      borderRadius: 'var(--radius-sharp)',
                      border: '1px solid',
                      borderColor: isNext ? 'var(--color-rust)' : 'var(--color-line-strong)',
                      background: done ? 'var(--color-concrete-dark)' : 'transparent',
                      color: done
                        ? 'var(--color-paper)'
                        : isNext
                          ? 'var(--color-rust)'
                          : 'var(--color-concrete-wet)',
                      fontWeight: isNext ? 700 : 400,
                    }}
                  >
                    {i + 1}회 {clock(at)}
                  </span>
                );
              })}
          </div>
          {nextMixStartAt && (
            <p style={{ fontSize: '0.8rem', margin: '8px 0 0' }}>
              다음 회차 권장 출하{' '}
              <strong style={{ fontFamily: 'var(--font-mono)' }}>{clock(nextMixStartAt)}</strong> ·{' '}
              {nextMixStartAt > now ? (
                <span>{remaining(nextMixStartAt, now)} 뒤</span>
              ) : (
                <span style={{ color: 'var(--color-warn)' }}>
                  {Math.round((now - nextMixStartAt) / MIN)}분 지났습니다 — 지금 바로 출하하세요
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {/* 출하 지시 */}
      {left > 0 && (
        <div style={{ marginTop: 14 }}>
          <label className="field">
            <span className="label">차량 고르기 (대기 중 {free.length}대)</span>
            <select className="select" value={truckId} onChange={(e) => setTruckId(e.target.value)}>
              <option value="">차량을 고르세요</option>
              {free.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.no}호차 · {t.plateNo}
                  {t.driverId ? ' · 기사 배정됨' : ' · 기사 없음'}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p style={{ fontSize: '0.82rem', color: 'var(--color-bad)', margin: '0 0 8px' }}>
              {error}
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={!truckId || !route || sending}
            onClick={() => void send()}
          >
            {sending ? '출하 지시 중…' : `${m3(nextVolume)} 출하 지시 — 지금 비비기 시작`}
          </button>
        </div>
      )}

      {/* 출하 내역 */}
      {deliveries.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 14 }}>
          <table className="table">
            <thead>
              <tr>
                <th>호차</th>
                <th className="num">물량</th>
                <th>비비기</th>
                <th>도착 예상</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => {
                const truck = db.trucks.find((t) => t.id === d.truckId);
                const phase = DeliveryRules.phase(d, now);
                return (
                  <tr key={d.id}>
                    <td>{truck?.no}</td>
                    <td className="num">{d.volumeM3}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{clock(d.mixStartAt)}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{clock(d.etaCurrentAt)}</td>
                    <td>
                      <Tag tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Tag>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
