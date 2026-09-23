'use client';

/**
 * 현장 — 주문 목록과 전자 납품서.
 *
 * 납품서의 핵심은 "비비기 시작 ~ 타설 완료"가 제한시간 안에 들어왔는지다.
 * 그 판정을 사람이 계산하지 않아도 되게 자동으로 찍는다.
 */

import { useState } from 'react';
import { SiteShell } from '@/components/RoleShells';
import { Empty, MockNotice, Panel, Row, Tag } from '@/components/ui';
import { clock, dateClock, m3 } from '@/lib/format';
import {
  DeliveryRules,
  MIN,
  ORDER_STATUS_LABEL,
  ORDER_TONE,
  PourRules,
  cementShort,
  slumpLabel,
  specText,
  strengthLabel,
} from '@/lib/rules';
import { deliveriesOfOrder, ordersOfSite, setOrderStatus } from '@/lib/store';
import { useDb, useMounted } from '@/lib/store/hooks';
import type { Order, Site } from '@/lib/types';

export default function OrdersPage() {
  return (
    <SiteShell
      title="주문 · 납품서"
      description="비비기부터 타설 완료까지의 경과시간을 자동으로 판정합니다."
      showClock={false}
    >
      {(site) => <OrdersBody site={site} />}
    </SiteShell>
  );
}

function OrdersBody({ site }: { site: Site }) {
  const db = useDb();
  const mounted = useMounted();
  const [openId, setOpenId] = useState<string | null>(null);
  const orders = ordersOfSite(db, site.id);

  if (!mounted) return <Empty>불러오는 중…</Empty>;

  return (
    <>
      <MockNotice />

      {orders.length === 0 ? (
        <Panel>
          <Empty>주문 내역이 없습니다.</Empty>
        </Panel>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {orders.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              open={openId === o.id}
              onToggle={() => setOpenId(openId === o.id ? null : o.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function OrderCard({
  order,
  open,
  onToggle,
}: {
  order: Order;
  open: boolean;
  onToggle: () => void;
}) {
  const db = useDb();
  const plant = db.plants.find((p) => p.id === order.plantId);
  const site = db.sites.find((s) => s.id === order.siteId);
  const deliveries = deliveriesOfOrder(db, order.id);
  const poured = deliveries.filter((d) => d.completedAt).reduce((s, d) => s + d.volumeM3, 0);

  return (
    <article className="card card-pad" style={{ padding: 12 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'block',
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
          <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
            {order.code}
          </strong>
          <span style={{ fontSize: '0.9rem' }}>{plant?.name}</span>
          <span style={{ marginLeft: 'auto' }}>
            <Tag tone={ORDER_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Tag>
          </span>
        </div>
        <p
          style={{
            fontSize: '0.8rem',
            color: 'var(--color-concrete-wet)',
            margin: 0,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {specText(order.spec)} · {m3(order.volumeM3)} · 타설 {dateClock(order.pourStartAt)}
        </p>
        {order.planId && (
          <p style={{ fontSize: '0.74rem', color: 'var(--color-rust)', margin: '4px 0 0' }}>
            AI 배분으로 만들어진 주문
          </p>
        )}
        {order.rejectReason && (
          <p style={{ fontSize: '0.78rem', color: 'var(--color-bad)', margin: '4px 0 0' }}>
            거절 사유: {order.rejectReason}
          </p>
        )}
      </button>

      {order.status === 'requested' && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 8, paddingLeft: 0, color: 'var(--color-bad)' }}
          onClick={() => setOrderStatus(order.id, 'cancelled')}
        >
          주문 취소
        </button>
      )}

      {open && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--color-line)', paddingTop: 14 }}>
          <Row label="현장">{site?.name}</Row>
          <Row label="공장">
            {plant?.name} · {plant?.phone}
          </Row>
          <Row label="종류">{order.spec.type}</Row>
          <Row label="호칭">
            {order.spec.aggMm}-{order.spec.strength}-{order.spec.slumpMm}
          </Row>
          <Row label="강도">{strengthLabel(order.spec)}</Row>
          <Row label="슬럼프">{slumpLabel(order.spec)}</Row>
          <Row label="시멘트">{cementShort(order.spec.cement)}</Row>
          <Row label="외기온도">
            {order.tempC}℃ · 제한 {PourRules.limitMinutes(order.tempC)}분
          </Row>
          <Row label="타설 진행">
            {m3(poured)} / {m3(order.volumeM3)}
          </Row>

          {deliveries.length > 0 && (
            <>
              <h3 style={{ fontSize: '0.9rem', margin: '16px 0 8px' }}>
                전자 납품서 {deliveries.length}장
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>호차</th>
                      <th className="num">물량</th>
                      <th>비비기</th>
                      <th>도착</th>
                      <th>타설완료</th>
                      <th className="num">경과</th>
                      <th>판정</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.map((d) => {
                      const truck = db.trucks.find((t) => t.id === d.truckId);
                      const elapsed = d.completedAt
                        ? Math.round((d.completedAt - d.mixStartAt) / MIN)
                        : null;
                      const within = DeliveryRules.withinLimit(d);
                      return (
                        <tr key={d.id}>
                          <td>{truck?.no}</td>
                          <td className="num">{d.volumeM3}</td>
                          <td>{clock(d.mixStartAt)}</td>
                          <td>{clock(d.arriveAt)}</td>
                          <td>{clock(d.completedAt)}</td>
                          <td className="num">{elapsed != null ? `${elapsed}분` : '—'}</td>
                          <td>
                            {within == null ? (
                              <Tag tone="info">진행 중</Tag>
                            ) : within ? (
                              <Tag tone="ok">제한 내</Tag>
                            ) : (
                              <Tag tone="bad">초과</Tag>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p
                style={{
                  fontSize: '0.76rem',
                  color: 'var(--color-concrete-mid)',
                  margin: '8px 0 0',
                }}
              >
                제한시간은 비비기 시작부터 타설 완료까지 {deliveries[0]?.limitMinutes}분 (외기{' '}
                {order.tempC}℃ 기준). 책임기술자 승인이나 응결지연제 사용 시 달라질 수 있습니다.
              </p>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                style={{ marginTop: 12 }}
                onClick={() => window.print()}
              >
                인쇄
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
