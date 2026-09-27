'use client';

/**
 * 레미콘사 — 현황판.
 *
 * 공장이 하루 종일 붙들고 보는 화면이다. 세 가지를 한 번에 답해야 한다.
 *   ① 지금 얼마나 내보냈나        ② 더 내보낼 수 있나 (차량·물량·사양)
 *   ③ 다음 차를 언제 비벼야 하나  ④ 어느 현장이 얼마나 기다리나
 *
 * '출하 가능' 입력이 이 화면에 같이 있는 이유는, 현장이 보는 주문 가능 공장 목록이
 * 이 값으로 결정되기 때문이다. 수시로 고쳐야 하므로 현황과 떼어 놓지 않는다.
 */

import Link from 'next/link';
import { useState } from 'react';
import { PlantShell } from '@/components/RoleShells';
import { Alert, Empty, MockNotice, Panel, Row, Stat, StatGrid, Tag } from '@/components/ui';
import {
  dayRange,
  demandBySite,
  isWithin,
  shipmentRhythm,
  targetInterval,
  upcomingShipments,
} from '@/lib/dashboard';
import { ago, clock, duration, failure, m3, remaining } from '@/lib/format';
import {
  DeliveryRules,
  MIN,
  PHASE_LABEL,
  PHASE_TONE,
  TRUCK_CAPACITY_M3,
  cementShort,
  specText,
} from '@/lib/rules';
import {
  activeDeliveriesOfPlant,
  deliveriesOfPlant,
  updatePlantStatus,
  type Db,
} from '@/lib/store';
import { useDb, useMounted, useNow } from '@/lib/store/hooks';
import type { Delivery, Order, Plant } from '@/lib/types';

export default function PlantDashboardPage() {
  return (
    <PlantShell
      title="출하 현황"
      description="오늘 얼마나 내보냈고, 다음 차를 언제 비벼야 하는지 봅니다."
    >
      {(plant) => <DashboardBody plant={plant} />}
    </PlantShell>
  );
}

function DashboardBody({ plant }: { plant: Plant }) {
  const db = useDb();
  const now = useNow(2000);
  const mounted = useMounted();

  const day = dayRange(now || Date.now());
  const today = deliveriesOfPlant(db, plant.id).filter((d) => isWithin(d.mixStartAt, day));
  const active = activeDeliveriesOfPlant(db, plant.id);

  const orders = db.orders.filter(
    (o) => o.plantId === plant.id && (o.status === 'accepted' || o.status === 'delivering'),
  );

  // 차량 배차 현황
  const busy = new Set(active.map((d) => d.truckId));
  const myTrucks = db.trucks.filter((t) => t.plantId === plant.id);
  const idle = myTrucks.filter((t) => !busy.has(t.id));
  const withDriver = myTrucks.filter((t) => t.driverId).length;

  // 오늘 출하량
  const todayVolume = today.reduce((s, d) => s + d.volumeM3, 0);

  if (!mounted) return <Empty>불러오는 중…</Empty>;

  return (
    <>
      <MockNotice />

      <UrgentInbox plant={plant} />

      {!plant.isOpen && (
        <Panel style={{ borderWidth: 2, borderColor: 'var(--color-bad)' }}>
          <Alert tone="bad" title="출하 중지 중">
            지금 이 공장은 현장의 주문 가능 목록에 뜨지 않습니다. 아래 &lsquo;출하 중지&rsquo; 를
            풀어야 주문을 받을 수 있습니다.
          </Alert>
        </Panel>
      )}

      {/* ① 오늘 */}
      <Panel
        title="오늘"
        aside={<Tag tone="muted">{new Date(now).toLocaleDateString('ko-KR')}</Tag>}
      >
        <StatGrid>
          <Stat label="오늘 출하" value={Math.round(todayVolume)} unit="m³" tone="accent" />
          <Stat label="출하 대수" value={today.length} unit="대" />
          <Stat
            label="운행 중"
            value={active.length}
            unit="대"
            tone={active.length > 0 ? 'accent' : 'muted'}
          />
          <Stat
            label="대기 차량"
            value={idle.length}
            unit="대"
            tone={idle.length === 0 ? 'warn' : 'muted'}
            hint={`기사 배정 ${withDriver}대`}
          />
        </StatGrid>
      </Panel>

      {/* ② 출하 능력 */}
      <Capacity plant={plant} idle={idle.length} now={now} />

      {/* ③ 출하 간격 */}
      <Interval plant={plant} today={today} orders={orders} db={db} now={now} />

      {/* ④ 출하 예정 차량 */}
      <Upcoming plant={plant} orders={orders} db={db} now={now} />

      {/* ⑤ 현장별 주문량 */}
      <BySite plant={plant} orders={orders} db={db} />

      {/* ⑥ 차량 배차 현황 */}
      <Fleet plant={plant} active={active} idle={idle.length} db={db} now={now} />

      {/* ⑦ 생산 가능 사양 */}
      <Panel title="생산 가능 사양">
        <Row label="종류·최대강도">
          {Object.entries(plant.cap.maxStrength)
            .map(([type, max]) => `${type} ${max}MPa`)
            .join(' · ')}
        </Row>
        <Row label="굵은골재">{plant.cap.aggs.map((a) => `${a}mm`).join(', ')}</Row>
        <Row label="슬럼프 플로">{plant.cap.flow ? '생산 가능' : '미생산'}</Row>
        <Row label="시멘트">{plant.cap.cements.map(cementShort).join(', ')}</Row>
        <p style={{ fontSize: '0.78rem', color: 'var(--color-concrete-mid)', margin: '10px 0 0' }}>
          생산 가능 사양은 시연용 고정값입니다. 실제 서비스에서는 공장이 직접 고칠 수 있어야
          합니다.
        </p>
      </Panel>
    </>
  );
}

/* ==========================================================================
 * 출하 능력 — 현장의 주문 가능 목록을 결정하는 값
 * ======================================================================== */

function Capacity({ plant, idle, now }: { plant: Plant; idle: number; now: number }) {
  // 시간당 생산 가능 물량 = 한 현장에 보낼 수 있는 대수 × 1대 적재량
  const hourlyVolume = plant.hourlyRate * TRUCK_CAPACITY_M3;

  /**
   * 입력칸은 저장 전까지 화면에만 둔다.
   *
   * 전에는 한 글자 칠 때마다 DB 에 썼다. "240" 을 지우고 "180" 을 치면 2·4·0·1·8 이
   * 전부 저장되고, 그 값이 그대로 현장 화면에 실시간으로 뜬다 — 0m³ 이 잠깐 보이면
   * 현장은 그 공장을 후보에서 지운다. 다 적고 저장을 누를 때 한 번만 쓴다.
   */
  const [draft, setDraft] = useState<{ trucks: string; volume: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trucks = draft ? draft.trucks : String(plant.availableTrucks);
  const volume = draft ? draft.volume : String(plant.availableVolume);
  const dirty = draft != null;

  const edit = (patch: Partial<{ trucks: string; volume: string }>) =>
    setDraft({ trucks, volume, ...patch });

  const bump = (key: 'trucks' | 'volume', by: number) => {
    const cur = Number(key === 'trucks' ? trucks : volume) || 0;
    edit({ [key]: String(Math.max(0, Math.round((cur + by) * 10) / 10)) });
  };

  async function save() {
    const t = Number(trucks);
    const v = Number(volume);

    const problem =
      !Number.isInteger(t) || t < 0
        ? '출하 가능 차량은 0 이상 정수로 입력하세요'
        : t > plant.fleetSize
          ? `출하 가능 차량이 보유 ${plant.fleetSize}대보다 많을 수 없습니다`
          : !(v >= 0 && v <= 9999)
            ? '출하 가능 물량은 0~9999m³ 로 입력하세요'
            : null;
    if (problem) {
      setError(problem);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updatePlantStatus(plant.id, { availableTrucks: t, availableVolume: v });
      setDraft(null);
    } catch (e) {
      setError(failure(e, '저장하지 못했습니다.'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleOpen(stop: boolean) {
    setError(null);
    try {
      await updatePlantStatus(plant.id, { isOpen: !stop });
    } catch (e) {
      setError(failure(e, '출하 상태를 바꾸지 못했습니다.'));
    }
  }

  return (
    <Panel
      title="출하 능력"
      aside={plant.isOpen ? <Tag tone="ok">출하 중</Tag> : <Tag tone="bad">출하 중지</Tag>}
    >
      <p style={{ fontSize: '0.78rem', color: 'var(--color-concrete-mid)', margin: '0 0 12px' }}>
        마지막 갱신 {ago(plant.updatedAt, now)}
        {plant.updatedAt ? ` · ${clock(plant.updatedAt)}` : ''} — 이 값으로 현장의 주문 가능 공장
        목록이 정해집니다.
      </p>

      <StatGrid>
        <Stat
          label="출하 가능 물량"
          value={Math.round(plant.availableVolume)}
          unit="m³"
          tone={plant.availableVolume <= 0 ? 'bad' : 'ok'}
        />
        <Stat
          label="출하 가능 차량"
          value={plant.availableTrucks}
          unit="대"
          tone={plant.availableTrucks <= 0 ? 'bad' : 'ok'}
          hint={`보유 ${plant.fleetSize}대`}
        />
        <Stat
          label="시간당 생산"
          value={hourlyVolume}
          unit="m³/h"
          hint={`${plant.hourlyRate}대/h · 한 현장 기준`}
        />
      </StatGrid>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginTop: 14,
        }}
      >
        <Stepper
          label="출하 가능 차량"
          unit="대"
          value={trucks}
          step={1}
          max={plant.fleetSize}
          onChange={(v) => edit({ trucks: v })}
          onBump={(by) => bump('trucks', by)}
        />
        <Stepper
          label="출하 가능 물량"
          unit="m³"
          value={volume}
          step={TRUCK_CAPACITY_M3}
          onChange={(v) => edit({ volume: v })}
          onBump={(by) => bump('volume', by)}
        />
      </div>

      {/* 배차 기록이 아는 대기 대수와 공장이 적은 값이 어긋날 수 있다 */}
      <p style={{ fontSize: '0.8rem', color: 'var(--color-concrete-wet)', margin: '0 0 10px' }}>
        배차 기록상 지금 대기 중인 차량은 <strong>{idle}대</strong>입니다.
        {Number(trucks) !== idle && (
          <>
            {' '}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ padding: '2px 6px', textDecoration: 'underline' }}
              onClick={() => edit({ trucks: String(idle) })}
            >
              가능 차량에 반영
            </button>
          </>
        )}
      </p>

      {error && (
        <p style={{ fontSize: '0.82rem', color: 'var(--color-bad)', margin: '0 0 8px' }}>{error}</p>
      )}

      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!dirty || saving}
        onClick={() => void save()}
      >
        {saving ? '저장 중…' : dirty ? '저장하고 현장에 공개' : '저장됨'}
      </button>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 0 4px',
          fontSize: '0.9rem',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={!plant.isOpen}
          onChange={(e) => void toggleOpen(e.target.checked)}
          style={{ width: 18, height: 18 }}
        />
        출하 중지 (점검·원자재 부족 등) — 누르는 즉시 반영됩니다
      </label>

      <p style={{ fontSize: '0.78rem', color: 'var(--color-concrete-mid)', margin: '6px 0 0' }}>
        레미콘은 쌓아 두는 재고가 없습니다. 굳기 전에 써야 하므로 주문을 받고 나서 비빕니다.
        그래서 &lsquo;재고&rsquo; 대신 <strong>지금 내보낼 수 있는 물량</strong>을 씁니다 — 원자재·믹서·차량 중
        가장 모자란 것으로 공장이 직접 판단해 적습니다.
      </p>
    </Panel>
  );
}

/* ==========================================================================
 * 출하 간격 — 연속 타설을 지키려면 이 간격을 맞춰야 한다
 * ======================================================================== */

function Interval({
  plant,
  today,
  orders,
  db,
  now,
}: {
  plant: Plant;
  today: Delivery[];
  orders: Order[];
  db: Db;
  now: number;
}) {
  const { sorted, lastMixStartAt, sinceLastMin, avgGapMin } = shipmentRhythm(today, now);
  const target = targetInterval(db, plant.id, orders);

  const behind = target != null && sinceLastMin != null && sinceLastMin > target.minutes;

  return (
    <Panel
      title="출하 간격"
      aside={
        behind ? (
          <Tag tone="warn">간격 벌어짐</Tag>
        ) : lastMixStartAt ? (
          <Tag tone="ok">정상</Tag>
        ) : undefined
      }
    >
      {sorted.length === 0 ? (
        <Empty>오늘 출하한 차량이 없습니다.</Empty>
      ) : (
        <>
          <StatGrid>
            <Stat
              label="마지막 출하로부터"
              value={sinceLastMin ?? '—'}
              unit="분"
              tone={behind ? 'warn' : 'muted'}
              hint={lastMixStartAt ? clock(lastMixStartAt) : undefined}
            />
            <Stat
              label="오늘 평균 간격"
              value={avgGapMin ?? '—'}
              unit={avgGapMin == null ? undefined : '분'}
            />
            <Stat
              label="권장 간격"
              value={target?.minutes ?? '—'}
              unit={target == null ? undefined : '분'}
              hint={target?.source === 'plan' ? 'AI 배분 시각표' : '펌프 속도 기준'}
            />
          </StatGrid>

          {behind && (
            <div style={{ marginTop: 12 }}>
              <Alert tone="warn" title="다음 차를 비빌 때가 지났습니다">
                마지막 출하로부터 {sinceLastMin}분 지났습니다. 권장 간격 {target?.minutes}분을
                넘겼으니 현장에 공백이 생길 수 있습니다.{' '}
                <Link href="/plant/dispatch" style={{ color: 'var(--color-rust)' }}>
                  배차하러 가기 →
                </Link>
              </Alert>
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {sorted.slice(-10).map((d) => (
              <span
                key={d.id}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.74rem',
                  padding: '3px 7px',
                  borderRadius: 'var(--radius-sharp)',
                  border: '1px solid var(--color-line-strong)',
                  color: 'var(--color-concrete-wet)',
                }}
              >
                {clock(d.mixStartAt)}
              </span>
            ))}
          </div>
          <p style={{ fontSize: '0.76rem', color: 'var(--color-concrete-mid)', margin: '8px 0 0' }}>
            최근 비비기 시작 시각입니다.
          </p>
        </>
      )}
    </Panel>
  );
}

/* ==========================================================================
 * 출하 예정 차량 — AI 배분 시각표에서 아직 안 내보낸 회차
 * ======================================================================== */

function Upcoming({
  plant,
  orders,
  db,
  now,
}: {
  plant: Plant;
  orders: Order[];
  db: Db;
  now: number;
}) {
  const { slots, unplanned } = upcomingShipments(db, plant.id, orders);

  return (
    <Panel
      title="출하 예정 차량"
      aside={slots.length > 0 ? <Tag tone="accent">{slots.length}대</Tag> : undefined}
    >
      {slots.length === 0 && unplanned.length === 0 ? (
        <Empty>
          출하 예정인 차량이 없습니다.
          <br />
          <Link href="/plant/orders" style={{ color: 'var(--color-rust)' }}>
            주문 관리로 가기 →
          </Link>
        </Empty>
      ) : (
        <>
          {slots.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>비비기</th>
                    <th>회차</th>
                    <th>현장</th>
                    <th>남은 시간</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.slice(0, 8).map((s, i) => {
                    const due = s.at <= now;
                    return (
                      <tr key={s.key}>
                        <td
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontWeight: i === 0 ? 700 : 400,
                            color: due ? 'var(--color-bad)' : undefined,
                          }}
                        >
                          {clock(s.at)}
                        </td>
                        <td>{s.round}회</td>
                        <td style={{ fontSize: '0.8rem' }}>{s.siteName}</td>
                        <td style={{ fontSize: '0.8rem' }}>
                          {due ? (
                            <Tag tone="bad">{Math.round((now - s.at) / MIN)}분 지남</Tag>
                          ) : (
                            remaining(s.at, now)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {unplanned.length > 0 && (
            <div style={{ marginTop: slots.length > 0 ? 12 : 0 }}>
              {unplanned.map((u) => (
                <Row key={u.orderId} label={u.orderCode}>
                  {u.siteName} · {u.trucksLeft}대 남음{' '}
                  <span
                    style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--color-concrete-mid)' }}
                  >
                    AI 배분 없이 들어온 주문이라 시각표가 없습니다
                  </span>
                </Row>
              ))}
            </div>
          )}

          <Link
            href="/plant/dispatch"
            className="btn btn-primary btn-block btn-sm"
            style={{ marginTop: 12 }}
          >
            배차 · 출하 지시
          </Link>
        </>
      )}
    </Panel>
  );
}

/* ==========================================================================
 * 현장별 주문량
 * ======================================================================== */

function BySite({ plant, orders, db }: { plant: Plant; orders: Order[]; db: Db }) {
  const rows = demandBySite(db, plant.id, orders);

  return (
    <Panel
      title="현장별 주문량"
      aside={rows.length > 0 ? <Tag tone="muted">{rows.length}개 현장</Tag> : undefined}
    >
      {rows.length === 0 ? (
        <Empty>진행 중인 주문이 없습니다.</Empty>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>현장</th>
                <th className="num">주문</th>
                <th className="num">총 물량</th>
                <th className="num">출하</th>
                <th className="num">남음</th>
                <th>타설</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.siteId}>
                  <td style={{ fontSize: '0.8rem' }}>{r.name}</td>
                  <td className="num">{r.orderCount}</td>
                  <td className="num">{Math.round(r.volumeM3)}</td>
                  <td className="num">{Math.round(r.sentM3)}</td>
                  <td
                    className="num"
                    style={{ color: r.leftM3 > 0 ? 'var(--color-rust)' : undefined }}
                  >
                    {Math.round(r.leftM3)}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                    {clock(r.nextPourAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ==========================================================================
 * 차량 배차 현황
 * ======================================================================== */

function Fleet({
  plant,
  active,
  idle,
  db,
  now,
}: {
  plant: Plant;
  active: Delivery[];
  idle: number;
  db: Db;
  now: number;
}) {
  return (
    <Panel
      title="차량 배차 현황"
      aside={
        <Tag tone={active.length > 0 ? 'accent' : 'muted'}>
          {active.length} / {plant.fleetSize}대 운행
        </Tag>
      }
    >
      <StatGrid min={96}>
        <Stat label="보유" value={plant.fleetSize} unit="대" />
        <Stat label="운행 중" value={active.length} unit="대" tone="accent" />
        <Stat label="대기" value={idle} unit="대" tone={idle === 0 ? 'warn' : 'ok'} />
        <Stat
          label="운반 물량"
          value={Math.round(active.reduce((s, d) => s + d.volumeM3, 0))}
          unit="m³"
        />
      </StatGrid>

      {active.length === 0 ? (
        <p style={{ fontSize: '0.84rem', color: 'var(--color-concrete-mid)', margin: '12px 0 0' }}>
          운행 중인 차량이 없습니다.
        </p>
      ) : (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>호차</th>
                <th>현장</th>
                <th className="num">물량</th>
                <th>상태</th>
                <th>도착 예상</th>
                <th>기한</th>
              </tr>
            </thead>
            <tbody>
              {active
                .slice()
                .sort((a, b) => a.etaCurrentAt - b.etaCurrentAt)
                .map((d) => {
                  const truck = db.trucks.find((t) => t.id === d.truckId);
                  const site = db.sites.find((s) => s.id === d.siteId);
                  const phase = DeliveryRules.phase(d, now);
                  const limit = DeliveryRules.limitLevel(d, now);
                  return (
                    <tr key={d.id}>
                      <td>{truck?.no}</td>
                      <td style={{ fontSize: '0.8rem' }}>{site?.name}</td>
                      <td className="num">{d.volumeM3}</td>
                      <td>
                        <Tag tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Tag>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{clock(d.etaCurrentAt)}</td>
                      <td>
                        <Tag tone={limit}>{duration((d.limitAt - now) / MIN)}</Tag>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: '0.78rem', color: 'var(--color-concrete-mid)', margin: '10px 0 0' }}>
        합계 {m3(active.reduce((s, d) => s + d.volumeM3, 0))} 운반 중
      </p>
    </Panel>
  );
}

/* ==========================================================================
 * 긴급 주문
 *
 * 현장이 타설 공백을 겪고 있을 때 보낸 주문이다. 수락이 늦으면 현장은 다른
 * 공장을 찾는다 — 그래서 현황판 맨 위에 둔다.
 * ======================================================================== */

function UrgentInbox({ plant }: { plant: Plant }) {
  const db = useDb();
  const urgent = db.orders
    .filter((o) => o.plantId === plant.id && o.urgent && o.status === 'requested')
    .sort((a, b) => a.createdAt - b.createdAt);

  if (urgent.length === 0) return null;

  return (
    <Panel
      title={`긴급 배차 요청 ${urgent.length}건`}
      aside={<Tag tone="bad">지금 확인</Tag>}
      style={{ borderWidth: 2, borderColor: 'var(--color-bad)' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {urgent.map((o) => {
          const site = db.sites.find((s) => s.id === o.siteId);
          return (
            <Alert
              key={o.id}
              tone="bad"
              title={`${site?.name ?? ''} · ${m3(o.volumeM3)} · ${specText(o.spec)}`}
            >
              {o.urgentReason ?? '현장 요청'} — {clock(o.createdAt)} 요청
            </Alert>
          );
        })}
      </div>
      <Link
        href="/plant/orders"
        className="btn btn-primary btn-block btn-sm"
        style={{ marginTop: 12 }}
      >
        수락 · 거절 결정하기
      </Link>
    </Panel>
  );
}

/* ==========================================================================
 * 숫자 한 칸 + 증감 버튼
 *
 * 공장 사무실에서 장갑 낀 채로 누르는 화면이다. 키보드로 지우고 다시 치는 것보다
 * ±버튼 한 번이 빠르고 틀리지 않는다. 직접 칠 수도 있게 입력칸은 그대로 둔다.
 * ======================================================================== */

function Stepper({
  label,
  unit,
  value,
  step,
  max,
  onChange,
  onBump,
}: {
  label: string;
  unit: string;
  value: string;
  step: number;
  max?: number;
  onChange: (v: string) => void;
  onBump: (by: number) => void;
}) {
  const n = Number(value);
  const atMax = max != null && Number.isFinite(n) && n >= max;

  return (
    <div className="field">
      <span className="label">
        {label} ({unit})
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          className="btn btn-outline"
          style={{ flex: 'none', width: 44, padding: 0, fontSize: '1.1rem' }}
          aria-label={`${label} 줄이기`}
          onClick={() => onBump(-step)}
        >
          −
        </button>
        <input
          type="number"
          className="input"
          inputMode="decimal"
          min={0}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-outline"
          style={{ flex: 'none', width: 44, padding: 0, fontSize: '1.1rem' }}
          aria-label={`${label} 늘리기`}
          disabled={atMax}
          onClick={() => onBump(step)}
        >
          +
        </button>
      </div>
    </div>
  );
}
