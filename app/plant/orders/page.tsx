'use client';

/**
 * 레미콘사 — 주문 관리.
 *
 * 새 주문이 오면 "우리가 만들 수 있는 사양인가 / 물량이 되는가 / 제한시간 안에 갈 수 있는가"를
 * 먼저 판정해 보여 준다. 공장이 일일이 따져 보지 않아도 되게 하기 위해서다.
 */

import { useEffect, useMemo, useState } from 'react';
import { PlantShell } from '@/components/RoleShells';
import { Alert, Empty, MockNotice, Panel, Row, Tag } from '@/components/ui';
import { clock, dateClock, duration, m3 } from '@/lib/format';
import {
  DEFAULT_POUR_SETTINGS,
  ORDER_STATUS_LABEL,
  ORDER_TONE,
  PourRules,
  TRUCK_CAPACITY_M3,
  cementShort,
  slumpLabel,
  specText,
} from '@/lib/rules';
import { getRoute, type RouteResult } from '@/lib/services/route';
import { ordersOfPlant, setOrderStatus } from '@/lib/store';
import { useDb, useMounted } from '@/lib/store/hooks';
import type { Order, Plant } from '@/lib/types';

const REJECT_REASONS = [
  '출하 능력 초과',
  '해당 사양 생산 불가',
  '원자재(골재·시멘트) 부족',
  '제한시간 내 도착 불가',
  '설비 점검 중',
];

export default function PlantOrdersPage() {
  return (
    <PlantShell title="주문 관리" description="새 주문을 확인하고 수락하거나 사유를 달아 거절합니다.">
      {(plant) => <OrdersBody plant={plant} />}
    </PlantShell>
  );
}

function OrdersBody({ plant }: { plant: Plant }) {
  const db = useDb();
  const mounted = useMounted();
  const orders = ordersOfPlant(db, plant.id);
  // 긴급이 먼저다 — 현장이 이미 공백을 겪고 있다는 뜻이다
  const pending = orders
    .filter((o) => o.status === 'requested')
    .sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || a.createdAt - b.createdAt);
  const urgentCount = pending.filter((o) => o.urgent).length;
  const others = orders.filter((o) => o.status !== 'requested');

  if (!mounted) return <Empty>불러오는 중…</Empty>;

  return (
    <>
      <MockNotice />

      {urgentCount > 0 && (
        <Panel style={{ borderWidth: 2, borderColor: 'var(--color-bad)' }}>
          <Alert tone="bad" title={`긴급 배차 요청 ${urgentCount}건`}>
            현장이 타설 공백을 겪고 있습니다. 수락 여부를 바로 알려 주세요 — 늦어지면 현장은 다른
            공장을 찾아야 합니다.
          </Alert>
        </Panel>
      )}

      <Panel title={`수락 대기 ${pending.length}건`}>
        {pending.length === 0 ? (
          <Empty>새 주문이 없습니다.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {pending.map((o) => (
              <PendingCard key={o.id} order={o} plant={plant} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title={`지난 주문 ${others.length}건`}>
        {others.length === 0 ? (
          <Empty>아직 처리한 주문이 없습니다.</Empty>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>주문번호</th>
                  <th>사양</th>
                  <th className="num">물량</th>
                  <th>타설</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {others.map((o) => (
                  <tr key={o.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{o.code}</td>
                    <td style={{ fontSize: '0.8rem' }}>{specText(o.spec)}</td>
                    <td className="num">{o.volumeM3}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                      {clock(o.pourStartAt)}
                    </td>
                    <td>
                      <Tag tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function PendingCard({ order, plant }: { order: Order; plant: Plant }) {
  const db = useDb();
  const site = db.sites.find((s) => s.id === order.siteId);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState(REJECT_REASONS[0]);

  useEffect(() => {
    if (!site) return;
    let alive = true;
    getRoute(plant, site, order.pourStartAt).then((r) => alive && setRoute(r));
    return () => {
      alive = false;
    };
  }, [plant, site, order.pourStartAt]);

  const allowedMin = PourRules.allowedTravelMinutes(order.tempC, DEFAULT_POUR_SETTINGS);
  const spec = PourRules.judgeSpec(plant, order.spec);
  const supply = PourRules.judgeSupply(plant, order.volumeM3, order.spec);
  const travel = route ? PourRules.judgeTravel(route.minutes, allowedMin) : null;
  const worst = PourRules.worst(spec.level, supply.level, travel?.level ?? 'ok');

  const trucks = Math.ceil(order.volumeM3 / TRUCK_CAPACITY_M3);

  const roundsInfo = useMemo(() => {
    const plan = db.plans.find((p) => p.id === order.planId);
    return plan?.items.find((i) => i.plantId === plant.id) ?? null;
  }, [db.plans, order.planId, plant.id]);

  return (
    <article
      className="card card-pad"
      style={{
        borderWidth: 2,
        borderColor:
          worst === 'bad' ? 'var(--color-bad)' : worst === 'warn' ? 'var(--color-warn)' : 'var(--color-ok)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>{order.code}</strong>
        {order.urgent && <Tag tone="bad">긴급</Tag>}
        <span style={{ marginLeft: 'auto' }}>
          <Tag tone={worst}>
            {worst === 'ok' ? '수락 가능' : worst === 'warn' ? '확인 필요' : '수락 어려움'}
          </Tag>
        </span>
      </div>

      {order.urgent && (
        <div style={{ marginBottom: 10 }}>
          <Alert tone="bad" title="현장 사유">
            {order.urgentReason ?? '현장 요청'}
          </Alert>
        </div>
      )}

      <Row label="현장">{site?.name}</Row>
      <Row label="사양">{specText(order.spec)}</Row>
      <Row label="슬럼프">{slumpLabel(order.spec)}</Row>
      <Row label="시멘트">{cementShort(order.spec.cement)}</Row>
      <Row label="물량">
        {m3(order.volumeM3)} · {trucks}대
      </Row>
      <Row label="타설 시작">{dateClock(order.pourStartAt)}</Row>
      <Row label="이동시간">
        {route ? (
          <>
            {duration(route.minutes)} · {route.distanceKm}km{' '}
            {travel && <Tag tone={travel.level}>{travel.label}</Tag>}
          </>
        ) : (
          '계산 중…'
        )}
      </Row>
      <Row label="허용 이동시간">
        {allowedMin}분 (외기 {order.tempC}℃ · 제한 {PourRules.limitMinutes(order.tempC)}분)
      </Row>

      {roundsInfo && (
        <p
          style={{
            fontSize: '0.8rem',
            color: 'var(--color-rust)',
            margin: '10px 0 0',
          }}
        >
          AI 배분 주문 — 회차별 출하 시각이 지정돼 있습니다 (
          {clock(Math.min(...roundsInfo.mixStartAts))} ~ {clock(Math.max(...roundsInfo.mixStartAts))}
          ). 배차 화면에서 시각표를 볼 수 있습니다.
        </p>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        <Tag tone={spec.level}>{spec.label}</Tag>
        <Tag tone={supply.level}>{supply.label}</Tag>
      </div>

      {rejecting ? (
        <div style={{ marginTop: 12 }}>
          <label className="field">
            <span className="label">거절 사유</span>
            <select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REJECT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setOrderStatus(order.id, 'rejected', reason)}
            >
              거절 보내기
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRejecting(false)}>
              취소
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => setOrderStatus(order.id, 'accepted')}
          >
            수락
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setRejecting(true)}>
            거절
          </button>
        </div>
      )}
    </article>
  );
}
