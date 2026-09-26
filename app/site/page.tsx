'use client';

/**
 * 현장 — 현황판.
 *
 * 로그인하면 처음 열리는 화면이다. 현장소장이 알고 싶은 것은 순서가 정해져 있다.
 *   ① 지금 뭐가 잘못됐나 (지연·공백)   ② 얼마나 부었나   ③ 다음 차 언제 오나
 * 그래서 경고를 맨 위에, 숫자를 그 다음에, 차량 목록은 추적 화면에 맡긴다.
 *
 * 타설량·공백 계산은 추적 화면과 똑같은 monitorPour() 를 쓴다.
 * 두 화면이 다른 숫자를 보여 주면 현장에서 못 믿는다.
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { SiteShell } from '@/components/RoleShells';
import { Alert, Bar, Empty, MockNotice, Panel, Row, Stat, StatGrid, Tag } from '@/components/ui';
import { analyzeDelay, monitorPour } from '@/lib/ai/predict';
import { dayRange, todaysOrders } from '@/lib/dashboard';
import { clock, delayText, m3, remaining } from '@/lib/format';
import { DeliveryRules, ORDER_STATUS_LABEL, ORDER_TONE, RULES } from '@/lib/rules';
import { getPosition } from '@/lib/services/tracking';
import { useDb, useMounted, useNow } from '@/lib/store/hooks';
import type { Delivery, Site } from '@/lib/types';

export default function SiteDashboardPage() {
  return (
    <SiteShell title="현황" description="오늘 타설이 어떻게 돌아가는지 한 화면에서 봅니다.">
      {(site) => <DashboardBody site={site} />}
    </SiteShell>
  );
}

function DashboardBody({ site }: { site: Site }) {
  const db = useDb();
  const now = useNow(1000);
  const mounted = useMounted();

  const siteOrders = db.orders.filter((o) => o.siteId === site.id);

  const todayOrders = todaysOrders(db.orders, site.id, dayRange(now || Date.now()));

  // 진행 중인 타설 — 추적 화면과 같은 기준
  const activeOrders = siteOrders.filter(
    (o) => o.status === 'accepted' || o.status === 'delivering',
  );
  const activeIds = new Set(activeOrders.map((o) => o.id));
  const deliveries = db.deliveries.filter((d) => activeIds.has(d.orderId));

  // 위치를 다시 계산해 ETA 를 최신으로 — 추적 화면과 같은 함수를 쓴다
  const tracked = useMemo(
    () =>
      deliveries.map((d) =>
        d.completedAt ? d : { ...d, etaCurrentAt: getPosition(d, db.truckLocations, now).etaAt },
      ),
    [deliveries, db.truckLocations, now],
  );

  const totalVolumeM3 = activeOrders.reduce((s, o) => s + o.volumeM3, 0);
  const tempC = activeOrders[0]?.tempC ?? 20;

  const monitor = monitorPour({ totalVolumeM3, tempC, deliveries: tracked, now });

  const onRoad = tracked.filter((d) => !d.completedAt);
  const next = tracked.find((d) => d.id === monitor.nextDeliveryId);

  // 늦고 있는 차 — 처음 예상보다 늦거나 타설 기한이 빠듯한 차
  const delayed = onRoad
    .map((d) => ({ d, a: analyzeDelay(d) }))
    .filter((x) => x.a.level !== 'ok')
    .sort((a, b) => b.a.minutes - a.a.minutes);

  const todayVolume = todayOrders.reduce((s, o) => s + o.volumeM3, 0);
  const pendingCount = siteOrders.filter((o) => o.status === 'requested').length;

  if (!mounted) return <Empty>불러오는 중…</Empty>;

  return (
    <>
      <MockNotice />

      {/* ① 지금 잘못된 것 */}
      {activeOrders.length > 0 && monitor.level !== 'ok' && (
        <Panel
          style={{
            borderWidth: 2,
            borderColor: monitor.level === 'bad' ? 'var(--color-bad)' : 'var(--color-warn)',
          }}
        >
          <Alert
            tone={monitor.level}
            title={monitor.level === 'bad' ? '콜드조인트 위험' : '타설 공백 주의'}
          >
            {monitor.message}
          </Alert>
          <Link
            href="/site/tracking"
            className="btn btn-primary btn-block btn-sm"
            style={{ marginTop: 12 }}
          >
            타설 모니터 열기
          </Link>
        </Panel>
      )}

      {delayed.length > 0 && (
        <Panel title={`지연 알림 ${delayed.length}건`} aside={<Tag tone="warn">확인</Tag>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {delayed.slice(0, 4).map(({ d, a }) => (
              <DelayLine key={d.id} d={d} minutes={a.minutes} reason={a.reason} now={now} />
            ))}
          </div>
          {delayed.length > 4 && (
            <p style={{ fontSize: '0.78rem', color: 'var(--color-concrete-mid)', margin: '8px 0 0' }}>
              외 {delayed.length - 4}대
            </p>
          )}
        </Panel>
      )}

      {/* ② 오늘 */}
      <Panel
        title="오늘"
        aside={<Tag tone="muted">{new Date(now).toLocaleDateString('ko-KR')}</Tag>}
      >
        <StatGrid>
          <Stat label="오늘 주문" value={todayOrders.length} unit="건" />
          <Stat label="오늘 물량" value={Math.round(todayVolume)} unit="m³" />
          <Stat
            label="수락 대기"
            value={pendingCount}
            unit="건"
            tone={pendingCount > 0 ? 'warn' : 'muted'}
          />
          <Stat
            label="운행 중"
            value={onRoad.length}
            unit="대"
            tone={onRoad.length > 0 ? 'accent' : 'muted'}
          />
        </StatGrid>
      </Panel>

      {/* ③ 진행 중인 타설 */}
      {activeOrders.length === 0 ? (
        <Panel title="진행 중인 타설">
          <Empty>
            지금 진행 중인 타설이 없습니다.
            <br />
            <Link href="/site/order" style={{ color: 'var(--color-rust)' }}>
              주문하러 가기 →
            </Link>
          </Empty>
        </Panel>
      ) : (
        <Panel
          title="진행 중인 타설"
          aside={
            <Tag tone={monitor.level}>
              {monitor.level === 'ok'
                ? '연속 타설 중'
                : monitor.level === 'warn'
                  ? '공백 주의'
                  : '위험'}
            </Tag>
          }
        >
          <div style={{ marginBottom: 12 }}>
            <Bar done={monitor.pouredM3} total={totalVolumeM3} />
          </div>

          <StatGrid>
            <Stat
              label="타설 완료"
              value={Math.round(monitor.pouredM3)}
              unit="m³"
              tone="ok"
              hint={
                totalVolumeM3 > 0
                  ? `전체의 ${Math.round((monitor.pouredM3 / totalVolumeM3) * 100)}%`
                  : undefined
              }
            />
            <Stat
              label="남은 물량"
              value={Math.round(monitor.remainingM3)}
              unit="m³"
              hint={`총 ${Math.round(totalVolumeM3)}m³`}
            />
            <Stat
              label="타설 공백"
              value={monitor.gapMinutes == null ? '—' : Math.max(0, monitor.gapMinutes)}
              unit={monitor.gapMinutes == null ? undefined : '분'}
              tone={
                monitor.gapMinutes != null && monitor.gapMinutes >= RULES.COLD_JOINT_WARN_GAP_MIN
                  ? 'warn'
                  : 'muted'
              }
              hint="타설이 멈추는 시간"
            />
            <Stat
              label="이어치기 간격"
              value={monitor.jointIntervalMin ?? '—'}
              unit={monitor.jointIntervalMin == null ? undefined : '분'}
              tone={
                monitor.jointSlackMin == null
                  ? 'muted'
                  : monitor.jointSlackMin < 0
                    ? 'bad'
                    : monitor.jointSlackMin < RULES.COLD_JOINT_MARGIN_MIN
                      ? 'warn'
                      : 'ok'
              }
              hint={`허용 ${monitor.coldJointLimitMin}분`}
            />
          </StatGrid>

          {/* 다음 차량 */}
          <div style={{ marginTop: 14 }}>
            {next ? (
              <NextTruck d={next} now={now} />
            ) : (
              <Alert tone="bad" title="다음 차량 없음">
                남은 {m3(monitor.remainingM3)} 에 배차된 차량이 없습니다. 추가 주문이 필요합니다.
              </Alert>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Link href="/site/tracking" className="btn btn-primary btn-sm" style={{ flex: 1 }}>
              배송 추적
            </Link>
            <Link href="/site/allocate" className="btn btn-outline btn-sm" style={{ flex: 1 }}>
              AI 배분
            </Link>
          </div>
        </Panel>
      )}

      {/* 오늘 주문 목록 */}
      {todayOrders.length > 0 && (
        <Panel title={`오늘 주문 ${todayOrders.length}건`}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>주문</th>
                  <th>공장</th>
                  <th className="num">물량</th>
                  <th>타설</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {todayOrders.map((o) => {
                  const plant = db.plants.find((p) => p.id === o.plantId);
                  return (
                    <tr key={o.id}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                        {o.code}
                      </td>
                      <td style={{ fontSize: '0.8rem' }}>{plant?.name ?? '—'}</td>
                      <td className="num">{o.volumeM3}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{clock(o.pourStartAt)}</td>
                      <td>
                        <Tag tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Tag>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

/** 다음에 도착할 차 한 대 — 현장이 가장 자주 보는 줄이다 */
function NextTruck({ d, now }: { d: Delivery; now: number }) {
  const db = useDb();
  const truck = db.trucks.find((t) => t.id === d.truckId);
  const plant = db.plants.find((p) => p.id === d.plantId);
  const phase = DeliveryRules.phase(d, now);
  const delay = analyzeDelay(d);
  const overdue = d.etaCurrentAt <= now;

  return (
    <div
      style={{
        padding: 12,
        background: 'var(--color-paper)',
        border: '1px solid var(--color-line-strong)',
        borderRadius: 'var(--radius-sharp)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: '0.92rem' }}>다음 차량</strong>
        <span style={{ marginLeft: 'auto' }}>
          <Tag tone={delay.level}>{delayText(delay.minutes)}</Tag>
        </span>
      </div>

      <Row label="차량">{truck ? `${truck.no}호차 · ${truck.plateNo}` : '—'}</Row>
      <Row label="공장">{plant?.name ?? '—'}</Row>
      <Row label="적재">{m3(d.volumeM3)}</Row>
      <Row label="도착 예상">
        <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem' }}>
          {clock(d.etaCurrentAt)}
        </strong>{' '}
        <span style={{ fontWeight: 400, fontSize: '0.8rem', color: 'var(--color-concrete-mid)' }}>
          {overdue ? '도착 예정 시각 지남' : `${remaining(d.etaCurrentAt, now)} 뒤`}
        </span>
      </Row>
      <Row label="지금">{phase === 'loading' ? '상차 중' : '운반 중'}</Row>
    </div>
  );
}

function DelayLine({
  d,
  minutes,
  reason,
  now,
}: {
  d: Delivery;
  minutes: number;
  reason?: string;
  now: number;
}) {
  const db = useDb();
  const truck = db.trucks.find((t) => t.id === d.truckId);
  const overLimit = DeliveryRules.limitLevel(d, now) === 'bad';

  return (
    <Alert
      tone={overLimit ? 'bad' : 'warn'}
      title={`${truck?.no ?? '?'}호차 · ${minutes > 0 ? `${minutes}분 늦음` : '기한 빠듯'}`}
    >
      도착 예상 {clock(d.etaCurrentAt)} · 타설 기한 {clock(d.limitAt)}
      {overLimit ? ' — 기한을 넘깁니다' : ''}
      {reason ? ` · ${reason}` : ''}
    </Alert>
  );
}
