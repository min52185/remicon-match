'use client';

/**
 * 기사 — 내 배송 (지시서 5장 ★).
 *
 * 운행 중에만 위치를 보낸다. 시작할 때 동의를 받고, 하역 완료를 누르면 전송이 멈춘다
 * (기사 위치는 개인위치정보다 — 지시서 11장).
 *
 * 한계: 화면이 꺼지거나 다른 앱으로 넘어가면 브라우저가 GPS 를 멈춘다.
 * Screen Wake Lock 으로 화면을 켜 두지만 완전하지는 않다. 상용화 단계에서는
 * 네이티브 앱이나 차량 GPS 단말로 바꿔야 한다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DriverShell } from '@/components/RoleShells';
import { Empty, MockNotice, Panel, Row, Tag } from '@/components/ui';
import { clock, duration, failure, m3, remaining } from '@/lib/format';
import { DeliveryRules, PHASE_LABEL, PHASE_TONE, specText } from '@/lib/rules';
import { claimTruck, markArrived, markCompleted, pushLocation, releaseTruck } from '@/lib/store';
import { useDb, useMounted, useNow } from '@/lib/store/hooks';
import { useAuth } from '@/lib/auth';
import type { Delivery, Truck } from '@/lib/types';

/** 위치를 보내는 주기 — 지시서 3장: 10~15초 */
const SEND_INTERVAL_MS = 15_000;

export default function DriverPage() {
  return (
    <DriverShell
      title="내 배송"
      description="운행을 시작하면 현장 화면에 내 위치가 실시간으로 표시됩니다."
    >
      <DriverBody />
    </DriverShell>
  );
}

function DriverBody() {
  const db = useDb();
  const now = useNow(1000);
  const mounted = useMounted();
  const { demoMode, profile } = useAuth();

  // 로그인 상태에서는 내가 맡은 차의 배송만 본다 (DB 의 RLS 도 같은 기준으로 막는다)
  const myTruck = demoMode ? undefined : db.trucks.find((t) => t.driverId === profile?.id);

  const open = db.deliveries
    .filter((d) => !d.completedAt && (demoMode || d.truckId === myTruck?.id))
    .sort((a, b) => a.mixStartAt - b.mixStartAt);

  if (!mounted) return <Empty>불러오는 중…</Empty>;

  return (
    <>
      <MockNotice>
        시연용 가상 데이터입니다. 실제 GPS 를 켜면 이 브라우저의 위치가 현장 화면에 표시됩니다.
      </MockNotice>

      {!demoMode && <MyTruck truck={myTruck} />}

      {!demoMode && !myTruck ? null : open.length === 0 ? (
        <Panel>
          <Empty>
            배정된 배송이 없습니다.
            <br />
            레미콘사가 {myTruck ? `${myTruck.no}호차에 ` : ''}출하 지시를 내리면 여기에 뜹니다.
          </Empty>
        </Panel>
      ) : (
        open.map((d) => <DeliveryPanel key={d.id} delivery={d} now={now} />)
      )}
    </>
  );
}

/* ==========================================================================
 * 내 차량 — 기사가 빈 차를 자기 앞으로 가져온다
 *
 * 공장이 배차할 때 "어느 차"를 고르므로, 기사는 먼저 자기 차를 정해 둬야
 * 그 차의 배송이 이 화면에 뜬다. DB 정책도 '내 차의 배송'만 허용한다.
 * ======================================================================== */

function MyTruck({ truck }: { truck?: Truck }) {
  const db = useDb();
  const { profile } = useAuth();
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plant = db.plants.find((p) => p.id === truck?.plantId);

  // 내 소속 레미콘사의 공장에 있는, 아직 아무도 맡지 않은 차
  const myPlantIds = new Set(
    db.plants.filter((p) => !p.companyId || p.companyId === profile?.companyId).map((p) => p.id),
  );
  const free = db.trucks.filter((t) => myPlantIds.has(t.plantId) && !t.driverId);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setPicked('');
    } catch (e) {
      setError(failure(e, '차량 배정에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  if (truck) {
    return (
      <Panel title="내 차량" aside={<Tag tone="ok">배정됨</Tag>}>
        <Row label="호차">{truck.no}호차</Row>
        <Row label="차량번호">{truck.plateNo}</Row>
        <Row label="소속 공장">{plant?.name}</Row>
        <Row label="적재량">{m3(truck.capacityM3)}</Row>
        <p style={{ fontSize: '0.82rem', color: 'var(--color-concrete-wet)', margin: '12px 0 0' }}>
          레미콘사가 <strong>{truck.no}호차</strong>로 출하 지시를 내리면 아래에 배송이 뜹니다.
        </p>
        {error && <p style={{ fontSize: '0.82rem', color: 'var(--color-bad)' }}>{error}</p>}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 8, paddingLeft: 0 }}
          disabled={busy}
          onClick={() => void run(() => releaseTruck(truck.id))}
        >
          차량 반납
        </button>
      </Panel>
    );
  }

  return (
    <Panel title="내 차량" aside={<Tag tone="warn">미배정</Tag>}>
      <p style={{ fontSize: '0.9rem', margin: '0 0 12px', lineHeight: 1.6 }}>
        오늘 몰 차량을 먼저 고르세요. 고른 차로 출하 지시가 내려오면 여기에서 운행을 시작할 수
        있습니다.
      </p>

      {free.length === 0 ? (
        <Empty>
          빈 차량이 없습니다.
          <br />
          내 소속 레미콘사의 차량이 모두 다른 기사에게 배정돼 있거나, 소속이 잘못 지정됐을 수
          있습니다.
        </Empty>
      ) : (
        <>
          <label className="field">
            <span className="label">차량 고르기 ({free.length}대 비어 있음)</span>
            <select className="select" value={picked} onChange={(e) => setPicked(e.target.value)}>
              <option value="">고르세요</option>
              {free.map((t) => {
                const p = db.plants.find((x) => x.id === t.plantId);
                return (
                  <option key={t.id} value={t.id}>
                    {t.no}호차 · {t.plateNo} · {p?.name}
                  </option>
                );
              })}
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
            disabled={!picked || busy}
            onClick={() => void run(() => claimTruck(picked))}
          >
            {busy ? '배정 중…' : '이 차량 맡기'}
          </button>
        </>
      )}
    </Panel>
  );
}

function DeliveryPanel({ delivery, now }: { delivery: Delivery; now: number }) {
  const db = useDb();
  const truck = db.trucks.find((t) => t.id === delivery.truckId);
  const plant = db.plants.find((p) => p.id === delivery.plantId);
  const site = db.sites.find((s) => s.id === delivery.siteId);
  const order = db.orders.find((o) => o.id === delivery.orderId);
  const phase = DeliveryRules.phase(delivery, now);

  const [tracking, setTracking] = useState(false);
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);

  const watchRef = useRef<number | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const lastPushRef = useRef(0);

  const stop = useCallback(() => {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    wakeRef.current?.release().catch(() => {});
    wakeRef.current = null;
    setTracking(false);
  }, []);

  // 화면을 떠나면 위치 전송을 멈춘다
  useEffect(() => stop, [stop]);

  async function start() {
    setError(null);

    if (!('geolocation' in navigator)) {
      setError('이 브라우저는 위치 기능을 지원하지 않습니다.');
      return;
    }

    // 화면이 꺼지면 브라우저가 GPS 를 멈추므로 화면을 켜 둔다
    try {
      if ('wakeLock' in navigator) {
        wakeRef.current = await navigator.wakeLock.request('screen');
      }
    } catch {
      /* 배터리 절약 모드 등에서는 실패할 수 있다 — 위치 전송 자체는 계속한다 */
    }

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const at = Date.now();
        if (at - lastPushRef.current < SEND_INTERVAL_MS) return;
        lastPushRef.current = at;
        pushLocation({
          deliveryId: delivery.id,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speedKmh: pos.coords.speed != null ? Math.round(pos.coords.speed * 3.6) : undefined,
          heading: pos.coords.heading ?? undefined,
          recordedAt: at,
        });
        setLastSentAt(at);
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? '위치 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요.'
            : `위치를 받지 못했습니다 (${err.message})`,
        );
        stop();
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );

    setTracking(true);
  }

  return (
    <Panel
      title={`${truck?.no}호차 · ${site?.name ?? ''}`}
      aside={<Tag tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Tag>}
      style={{ borderWidth: tracking ? 2 : 1, borderColor: tracking ? 'var(--color-rust)' : undefined }}
    >
      <Row label="차량">
        {truck?.plateNo} · {truck?.driver}
      </Row>
      <Row label="공장">{plant?.name}</Row>
      <Row label="현장">{site?.address}</Row>
      {site?.accessNote && <Row label="진입 메모">{site.accessNote}</Row>}
      <Row label="적재">{m3(delivery.volumeM3)}</Row>
      {order && <Row label="사양">{specText(order.spec)}</Row>}
      <Row label="비비기 시작">{clock(delivery.mixStartAt)}</Row>
      <Row label="도착 예상">{clock(delivery.etaCurrentAt)}</Row>
      <Row label="타설 기한">
        {clock(delivery.limitAt)}{' '}
        <Tag tone={DeliveryRules.limitLevel(delivery, now)}>
          {remaining(delivery.limitAt, now)} 남음
        </Tag>
      </Row>
      <Row label="이동">
        {duration(delivery.travelMinutes)} · {delivery.distanceKm}km
      </Row>

      {error && (
        <p style={{ color: 'var(--color-bad)', fontSize: '0.84rem', margin: '12px 0 0' }}>{error}</p>
      )}

      {/* 운행 시작 전 — 동의 */}
      {!tracking && phase !== 'onsite' && (
        <div style={{ marginTop: 14 }}>
          <label
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              fontSize: '0.84rem',
              lineHeight: 1.5,
              cursor: 'pointer',
              marginBottom: 12,
            }}
          >
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              style={{ width: 18, height: 18, marginTop: 2, flex: 'none' }}
            />
            <span>
              운행 중 내 위치를 현장과 공장에 공유하는 것에 동의합니다. 위치는{' '}
              <strong>운행 중에만</strong> 수집되며, 하역 완료를 누르면 전송이 멈춥니다.
            </span>
          </label>
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={!consented}
            onClick={start}
          >
            운행 시작 — GPS 전송 켜기
          </button>
        </div>
      )}

      {/* 운행 중 */}
      {tracking && (
        <div style={{ marginTop: 14 }}>
          <p
            style={{
              fontSize: '0.84rem',
              margin: '0 0 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--color-rust)',
                display: 'inline-block',
              }}
            />
            위치 전송 중 · {SEND_INTERVAL_MS / 1000}초마다
            {lastSentAt && ` · 마지막 ${clock(lastSentAt)}`}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            {!delivery.arriveAt && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => markArrived(delivery.id, now)}
              >
                현장 도착
              </button>
            )}
            <button type="button" className="btn btn-outline" onClick={stop}>
              전송 멈추기
            </button>
          </div>
        </div>
      )}

      {/* 현장 도착 후 */}
      {phase === 'onsite' && (
        <button
          type="button"
          className="btn btn-primary btn-block"
          style={{ marginTop: 14 }}
          onClick={() => {
            markCompleted(delivery.id, now);
            stop();
          }}
        >
          하역 완료 — 납품서 확정
        </button>
      )}

      <p style={{ fontSize: '0.74rem', color: 'var(--color-concrete-mid)', margin: '12px 0 0' }}>
        화면이 꺼지면 브라우저가 위치 전송을 멈춥니다. 운행 중에는 화면을 켜 두세요.
      </p>
    </Panel>
  );
}
