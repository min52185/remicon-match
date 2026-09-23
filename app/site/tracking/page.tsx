'use client';

/**
 * 현장 — 배송 추적 + 타설 모니터.
 *
 * 한 화면에 둔 이유: 현장이 알고 싶은 것은 "차가 어디 있나"가 아니라
 * "타설이 끊기나"이기 때문이다. 공백 예측을 맨 위에, 차량은 그 아래에 둔다.
 */

import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import KakaoMap, { type MapMarker, type MapPath } from '@/components/KakaoMap';
import { SiteShell } from '@/components/RoleShells';
import { Empty, MockNotice, Panel, Row, Tag } from '@/components/ui';
import { analyzeDelay, monitorPour, recommend } from '@/lib/ai/predict';
import { clock, delayText, duration, m3, remaining } from '@/lib/format';
import { DeliveryRules, MIN, PHASE_LABEL, PHASE_TONE, specText } from '@/lib/rules';
import { getPosition, type Position } from '@/lib/services/tracking';
import { markCompleted, updateEta } from '@/lib/store';
import { useDb, useMounted, useNow } from '@/lib/store/hooks';
import type { Delivery, Site } from '@/lib/types';

export default function TrackingPage() {
  return (
    <SiteShell
      title="배송 추적 · 타설 모니터"
      description="차량 위치와 도착 예상, 다음 차까지의 공백을 함께 봅니다."
    >
      {(site) => <TrackingBody site={site} />}
    </SiteShell>
  );
}

function TrackingBody({ site }: { site: Site }) {
  const db = useDb();
  const now = useNow(1000);
  const mounted = useMounted();

  // 이 현장에서 지금 진행 중인 타설
  const activeOrders = db.orders.filter(
    (o) => o.siteId === site.id && (o.status === 'accepted' || o.status === 'delivering'),
  );
  const orderIds = new Set(activeOrders.map((o) => o.id));
  const deliveries = db.deliveries.filter((d) => orderIds.has(d.orderId));

  // 차량 위치와 다시 계산한 ETA
  const tracked = useMemo(
    () =>
      deliveries.map((d) => {
        const pos = getPosition(d, db.truckLocations, now);
        return { d: { ...d, etaCurrentAt: d.completedAt ? d.etaCurrentAt : pos.etaAt }, pos };
      }),
    [deliveries, db.truckLocations, now],
  );

  // 다시 계산한 ETA 를 가끔 저장한다 — 공장·기사 화면도 같은 값을 보게
  useEffect(() => {
    const id = window.setInterval(() => {
      for (const { d, pos } of tracked) {
        if (d.completedAt) continue;
        if (Math.abs(pos.etaAt - d.etaCurrentAt) > 30_000) updateEta(d.id, pos.etaAt);
      }
    }, 15_000);
    return () => window.clearInterval(id);
  }, [tracked]);

  const totalVolumeM3 = activeOrders.reduce((s, o) => s + o.volumeM3, 0);
  const tempC = activeOrders[0]?.tempC ?? 20;

  const monitor = monitorPour({
    totalVolumeM3,
    tempC,
    deliveries: tracked.map((t) => t.d),
    now,
  });

  const notArrived = tracked.filter((t) => !t.d.completedAt && (!t.d.arriveAt || t.d.arriveAt > now));
  const actions = recommend(monitor, notArrived.length);

  const markers: MapMarker[] = [
    { id: site.id, lat: site.lat, lng: site.lng, kind: 'site', label: '현장', tone: 'accent' },
    ...tracked
      .filter((t) => !t.d.completedAt)
      .map((t) => {
        const truck = db.trucks.find((x) => x.id === t.d.truckId);
        const delay = analyzeDelay(t.d);
        return {
          id: t.d.id,
          lat: t.pos.lat,
          lng: t.pos.lng,
          kind: 'truck' as const,
          label: `${truck?.no ?? '?'}호차 ${clock(t.d.etaCurrentAt)}`,
          tone: delay.level,
        };
      }),
  ];

  const paths: MapPath[] = tracked
    .filter((t) => !t.d.completedAt)
    .map((t) => ({ id: t.d.id, points: t.d.path, emphasis: true }));

  if (!mounted) return <Empty>불러오는 중…</Empty>;

  if (activeOrders.length === 0) {
    return (
      <>
        <MockNotice />
        <Panel>
          <Empty>
            진행 중인 타설이 없습니다.
            <br />
            <Link href="/site/order" style={{ color: 'var(--color-rust)' }}>
              주문하러 가기 →
            </Link>
          </Empty>
        </Panel>
      </>
    );
  }

  return (
    <>
      {/* 1. 타설 모니터 — 콜드조인트 경고 */}
      <Panel
        title="타설 모니터"
        aside={
          <Tag tone={monitor.level}>
            {monitor.level === 'ok' ? '연속 타설 중' : monitor.level === 'warn' ? '공백 주의' : '콜드조인트 위험'}
          </Tag>
        }
        style={{
          borderColor:
            monitor.level === 'bad'
              ? 'var(--color-bad)'
              : monitor.level === 'warn'
                ? 'var(--color-warn)'
                : undefined,
          borderWidth: monitor.level === 'ok' ? 1 : 2,
        }}
      >
        <p style={{ fontSize: '0.92rem', margin: '0 0 12px', lineHeight: 1.55 }}>
          {monitor.message}
        </p>

        <div style={{ marginBottom: 10 }}>
          <ProgressBar done={monitor.pouredM3} total={totalVolumeM3} />
        </div>

        <Row label="타설 완료">
          {m3(monitor.pouredM3)} / {m3(totalVolumeM3)}
        </Row>
        <Row label="남은 물량">{m3(monitor.remainingM3)}</Row>
        {monitor.currentPourEndAt && (
          <Row label="지금 차 종료 예상">{clock(monitor.currentPourEndAt)}</Row>
        )}
        {monitor.nextArrivalAt && <Row label="다음 차 도착">{clock(monitor.nextArrivalAt)}</Row>}
        {monitor.gapMinutes != null && (
          <Row label="공백">
            {monitor.gapMinutes <= 0 ? '없음 (겹침)' : `${monitor.gapMinutes}분`}{' '}
            <span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--color-concrete-mid)' }}>
              이어치기 허용 {monitor.coldJointLimitMin}분
            </span>
          </Row>
        )}

        {actions.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {actions.map((a, i) => (
              <div key={i} style={{ paddingLeft: 12, borderLeft: '2px solid var(--color-rust)' }}>
                <strong style={{ fontSize: '0.88rem', display: 'block' }}>{a.action}</strong>
                <span style={{ fontSize: '0.82rem', color: 'var(--color-concrete-wet)' }}>
                  {a.detail}
                </span>
              </div>
            ))}
            <Link href="/site/allocate" className="btn btn-outline btn-sm">
              AI 배분 다시 돌리기
            </Link>
          </div>
        )}
      </Panel>

      {/* 2. 지도 */}
      <Panel title="차량 위치와 추천 경로">
        <KakaoMap markers={markers} paths={paths} height={340} />
      </Panel>

      {/* 3. 배송 목록 */}
      <Panel title={`배송 ${tracked.length}건`}>
        {tracked.length === 0 ? (
          <Empty>아직 출하된 차량이 없습니다. 공장이 수락하고 배차하면 여기에 뜹니다.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tracked
              .sort((a, b) => a.d.etaCurrentAt - b.d.etaCurrentAt)
              .map(({ d, pos }) => (
                <DeliveryCard key={d.id} d={d} pos={pos} now={now} />
              ))}
          </div>
        )}
      </Panel>
    </>
  );
}

function DeliveryCard({ d, pos, now }: { d: Delivery; pos: Position; now: number }) {
  const db = useDb();
  const truck = db.trucks.find((x) => x.id === d.truckId);
  const plant = db.plants.find((x) => x.id === d.plantId);
  const order = db.orders.find((x) => x.id === d.orderId);
  const phase = DeliveryRules.phase(d, now);
  const delay = analyzeDelay(d);
  const limitLevel = DeliveryRules.limitLevel(d, now);

  return (
    <article className="card card-pad" style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <strong style={{ fontSize: '0.94rem' }}>
          {truck?.no}호차 · {plant?.name}
        </strong>
        <span style={{ marginLeft: 'auto' }}>
          <Tag tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Tag>
        </span>
      </div>

      <p
        style={{
          fontSize: '0.78rem',
          color: 'var(--color-concrete-mid)',
          margin: '0 0 8px',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {truck?.plateNo} · {truck?.driver} · {m3(d.volumeM3)}
        {order && ` · ${specText(order.spec)}`}
      </p>

      {phase !== 'done' && (
        <div style={{ marginBottom: 8 }}>
          <ProgressBar done={pos.progress * 100} total={100} tone={delay.level} />
        </div>
      )}

      <Row label="도착 예상">
        <strong style={{ fontFamily: 'var(--font-mono)' }}>{clock(d.etaCurrentAt)}</strong>{' '}
        <Tag tone={delay.level}>{delayText(delay.minutes)}</Tag>
      </Row>
      <Row label="비비기 시작">{clock(d.mixStartAt)}</Row>
      <Row label="타설 기한">
        {clock(d.limitAt)}{' '}
        <Tag tone={limitLevel}>{remaining(d.limitAt, now)} 남음</Tag>
      </Row>
      <Row label="이동">
        {duration(d.travelMinutes)} · {d.distanceKm}km
      </Row>

      {delay.reason && (
        <p style={{ fontSize: '0.8rem', color: 'var(--color-warn)', margin: '8px 0 0' }}>
          지연 원인: {delay.reason}
        </p>
      )}
      {pos.source === 'sim' && (
        <p style={{ fontSize: '0.74rem', color: 'var(--color-concrete-mid)', margin: '6px 0 0' }}>
          시연용 가짜 차량 — 기사 화면에서 운행을 시작하면 실제 GPS 로 바뀝니다.
        </p>
      )}

      {phase === 'onsite' && !d.completedAt && (
        <button
          type="button"
          className="btn btn-primary btn-sm btn-block"
          style={{ marginTop: 10 }}
          onClick={() => markCompleted(d.id, now)}
        >
          타설 완료 확인
        </button>
      )}
      {d.completedAt && (
        <p style={{ fontSize: '0.8rem', margin: '8px 0 0' }}>
          타설 완료 {clock(d.completedAt)} ·{' '}
          {DeliveryRules.withinLimit(d) ? (
            <Tag tone="ok">
              제한 {d.limitMinutes}분 이내 ({Math.round((d.completedAt - d.mixStartAt) / MIN)}분)
            </Tag>
          ) : (
            <Tag tone="bad">
              제한 초과 ({Math.round((d.completedAt - d.mixStartAt) / MIN)}분)
            </Tag>
          )}
        </p>
      )}
    </article>
  );
}

function ProgressBar({
  done,
  total,
  tone = 'ok',
}: {
  done: number;
  total: number;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (done / total) * 100)) : 0;
  const color =
    tone === 'bad' ? 'var(--color-bad)' : tone === 'warn' ? 'var(--color-warn)' : 'var(--color-rust)';
  return (
    <div
      style={{
        height: 6,
        background: 'var(--color-paper)',
        border: '1px solid var(--color-line)',
        borderRadius: 3,
        overflow: 'hidden',
      }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width .4s' }} />
    </div>
  );
}
