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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Nav from './Nav';
import PhotoInput from '@/components/PhotoInput';
import { DriverShell } from '@/components/RoleShells';
import { Alert, Empty, MockNotice, Panel, Row, Stat, StatGrid, Tag } from '@/components/ui';
import { siteQueue } from '@/lib/dashboard';
import { buildNote } from '@/lib/delivery-note';
import { clock, duration, failure, limitRemaining, m3, remaining } from '@/lib/format';
import {
  DeliveryRules,
  MIN,
  PHASE_LABEL,
  PHASE_TONE,
  TRUCK_CAPACITY_M3,
  UNLOAD_EST_MIN,
  specText,
} from '@/lib/rules';
import { getPosition } from '@/lib/services/tracking';
import { facePath, notePath } from '@/lib/services/photos';
import {
  claimTruck,
  createTruck,
  markArrived,
  markCompleted,
  pushLocation,
  releaseTruck,
  saveNotePhoto,
} from '@/lib/store';
import { useDb, useMounted, useNow } from '@/lib/store/hooks';
import { useAuth } from '@/lib/auth';
import { useUrgentAlert } from '@/lib/useUrgentAlert';
import type { Delivery, Truck } from '@/lib/types';

/** 위치를 보내는 주기 — 지시서 3장: 10~15초 */
const SEND_INTERVAL_MS = 15_000;

/** [가정] 도착 예상이 이 분 넘게 바뀌면 배차 변경으로 알린다 */
const ETA_ALERT_MIN = 10;

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

  const changes = useDispatchChanges(open);

  // 긴급 배차는 소리로도 알린다 — 기사는 운전 중이라 화면을 계속 볼 수 없다
  const urgentIds = open
    .filter((d) => db.orders.find((o) => o.id === d.orderId)?.urgent)
    .map((d) => d.id);
  const urgent = useUrgentAlert(urgentIds);

  /**
   * 지금 굴러가고 있는 배송. 상차가 끝나(departAt 이 지나) 운반 중인 첫 건이다.
   * 이게 있으면 화면은 네비게이션이 된다.
   */
  const [showList, setShowList] = useState(false);
  const moving = open.find((d) => DeliveryRules.phase(d, now) === 'transit');
  const driving = showList ? undefined : moving;

  // 운행이 끝나면(도착·완료) 목록으로 자연스럽게 돌아간다
  useEffect(() => {
    if (!moving && showList) setShowList(false);
  }, [moving, showList]);

  if (!mounted) return <Empty>불러오는 중…</Empty>;

  return (
    <>
      <MockNotice>
        시연용 가상 데이터입니다. 실제 GPS 를 켜면 이 브라우저의 위치가 현장 화면에 표시됩니다.
      </MockNotice>

      {urgent.fresh && (
        <Panel style={{ borderWidth: 2, borderColor: 'var(--color-bad)' }}>
          <Alert tone="bad" title={`긴급 배차 ${urgent.count}건`}>
            현장이 타설 공백을 겪고 있습니다. 아래 배송을 먼저 처리해 주세요.
          </Alert>
          <button
            type="button"
            className="btn btn-outline btn-sm btn-block"
            style={{ marginTop: 12 }}
            onClick={urgent.dismiss}
          >
            확인했습니다
          </button>
        </Panel>
      )}

      {changes.list.length > 0 && (
        <Panel style={{ borderWidth: 2, borderColor: 'var(--color-rust)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {changes.list.map((c, i) => (
              <Alert key={i} tone={c.tone} title={c.title}>
                {c.detail}
              </Alert>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-outline btn-sm btn-block"
            style={{ marginTop: 12 }}
            onClick={changes.dismiss}
          >
            확인했습니다
          </button>
        </Panel>
      )}

      {/*
        운행이 시작되면 그 배송 하나가 화면을 차지한다.
        상차 중에는 여러 건을 훑어볼 일이 있지만, 일단 바퀴가 구르면 기사가 볼 것은
        "지금 가는 길" 하나뿐이다. 그때까지 하던 대로 카드를 쌓아 두면 운전석에서
        지도가 손바닥만 하게 남는다.
      */}
      {driving ? (
        <DeliveryPanel
          key={driving.id}
          delivery={driving}
          now={now}
          navMode
          onShowList={open.length > 1 ? () => setShowList(true) : undefined}
        />
      ) : (
        <>
          {/* 운행 중인데 목록을 보러 나왔다 — 돌아갈 길을 맨 위에 둔다 */}
          {moving && (
            <Panel style={{ borderWidth: 2, borderColor: 'var(--color-rust)' }}>
              <strong style={{ fontSize: '0.94rem' }}>운행 중입니다</strong>
              <p style={{ fontSize: '0.86rem', margin: '6px 0 12px', lineHeight: 1.6 }}>
                {db.sites.find((s) => s.id === moving.siteId)?.name ?? '현장'} 으로 가는 중 ·
                도착 예상 {clock(moving.etaCurrentAt)}
              </p>
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => setShowList(false)}
              >
                네비게이션으로 돌아가기
              </button>
            </Panel>
          )}

          <MyProfile />

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
      )}
    </>
  );
}

/* ==========================================================================
 * 배차 변경 알림
 *
 * 기사는 운전 중이라 화면을 계속 볼 수 없다. 배차가 바뀐 것을 현장에 다 가서
 * 알면 늦는다. 그래서 바뀐 것만 맨 위에 모아 두고, 누르면 지워진다.
 *
 * 처음 화면을 열 때는 알리지 않는다 — 원래 있던 배차를 '새 배차'라고 하면
 * 알림을 믿지 않게 된다. 그런데 첫 렌더만 건너뛰면 모자란다. 서버 렌더에서는
 * 저장소가 비어 있고 브라우저에서 한 박자 뒤에 채워지므로, 그 사이를 '새 배차'로
 * 읽어 버린다. 그래서 화면을 연 뒤 SETTLE_MS 동안은 기준만 갱신한다.
 * ======================================================================== */

/** [가정] 저장소가 채워질 때까지 기다리는 시간 */
const SETTLE_MS = 700;

interface DispatchChange {
  tone: 'accent' | 'warn' | 'muted' | 'ok';
  title: string;
  detail: string;
}

function useDispatchChanges(open: Delivery[]) {
  const db = useDb();
  const [list, setList] = useState<DispatchChange[]>([]);
  /** 직전에 본 배송 — id → 도착 예상 */
  const seen = useRef<Map<string, number>>(new Map());
  const settled = useRef(false);
  const latest = useRef(open);
  latest.current = open;

  useEffect(() => {
    const id = window.setTimeout(() => {
      // 기다리는 동안 들어온 것은 '원래 있던 배차'로 친다
      seen.current = new Map(latest.current.map((d) => [d.id, d.etaCurrentAt]));
      settled.current = true;
    }, SETTLE_MS);
    return () => window.clearTimeout(id);
  }, []);

  /**
   * 무엇이 바뀌었는지만 추린 신호.
   * open 은 렌더마다 새 배열이라 그대로 의존성에 쓰면 1초마다 효과가 돈다.
   */
  const signature = open.map((d) => `${d.id}:${d.etaCurrentAt}`).join('|');

  // 화면 갱신 중에 상태를 바꾸면 안 되므로 effect 안에서 비교한다
  useEffect(() => {
    const current = latest.current;
    const nowMap = new Map(current.map((d) => [d.id, d.etaCurrentAt]));

    if (!settled.current) {
      seen.current = nowMap;
      return;
    }

    const before = seen.current;
    const found: DispatchChange[] = [];

    for (const d of current) {
      const site = db.sites.find((s) => s.id === d.siteId);
      const truck = db.trucks.find((t) => t.id === d.truckId);
      const was = before.get(d.id);

      const isUrgent = db.orders.find((o) => o.id === d.orderId)?.urgent === true;

      if (was == null) {
        found.push({
          tone: isUrgent ? 'warn' : 'accent',
          title: isUrgent ? '긴급 배차' : '새 배차',
          detail: `${truck?.no ?? '?'}호차 · ${site?.name ?? ''} · ${m3(d.volumeM3)} — 비비기 ${clock(
            d.mixStartAt,
          )}`,
        });
        continue;
      }

      const shift = Math.round((d.etaCurrentAt - was) / MIN);
      if (Math.abs(shift) >= ETA_ALERT_MIN) {
        found.push({
          tone: 'warn',
          title: `도착 예상 ${shift > 0 ? `${shift}분 늦어짐` : `${-shift}분 빨라짐`}`,
          detail: `${site?.name ?? ''} — ${clock(was)} → ${clock(d.etaCurrentAt)}`,
        });
      }
    }

    /*
     * 목록에서 빠진 배차.
     *
     * 빠지는 이유가 둘인데 예전에는 구분하지 않고 전부 "배차 취소" 라고 했다.
     * 기사가 하역 완료를 누르면 그 배송은 open 에서 빠지므로, 제 손으로 끝낸
     * 일에 "취소됐으니 레미콘사에 확인하세요" 가 떴다.
     *
     * 배송 자체가 남아 있고 완료 시각이 찍혀 있으면 끝난 것이고,
     * 배송이 통째로 사라졌으면 그때가 진짜 취소다.
     */
    for (const [id] of before) {
      if (nowMap.has(id)) continue;

      const gone = db.deliveries.find((x) => x.id === id);
      if (gone?.completedAt) {
        const note = buildNote(db, gone);
        found.push({
          tone: 'ok',
          title: '도착 완료',
          detail: note
            ? `${note.siteName} — 납품서 ${note.code} 를 ${clock(gone.completedAt)} 에 현장으로 보냈습니다.`
            : `${clock(gone.completedAt)} 타설 완료로 기록했습니다.`,
        });
      } else {
        found.push({
          tone: 'muted',
          title: '배차 취소',
          detail: '이 배송이 목록에서 빠졌습니다. 레미콘사에 확인하세요.',
        });
      }
    }

    seen.current = nowMap;
    if (found.length > 0) setList((prev) => [...found, ...prev].slice(0, 5));
  }, [signature, db]);

  return { list, dismiss: () => setList([]) };
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

      {/* 목록에 없는 차 — 새로 들어온 차나 임차 차량은 기사가 직접 넣는다 */}
      <NewTruckForm plantIds={[...myPlantIds]} />
    </Panel>
  );
}

function DeliveryPanel({
  delivery,
  now,
  navMode,
  onShowList,
}: {
  delivery: Delivery;
  now: number;
  /** 운행 중이라 이 배송 하나가 화면을 차지한다 — 지도를 키우고 상세는 접는다 */
  navMode?: boolean;
  onShowList?: () => void;
}) {
  const db = useDb();
  const { profile } = useAuth();
  const truck = db.trucks.find((t) => t.id === delivery.truckId);
  const plant = db.plants.find((p) => p.id === delivery.plantId);
  const site = db.sites.find((s) => s.id === delivery.siteId);
  const order = db.orders.find((o) => o.id === delivery.orderId);
  const phase = DeliveryRules.phase(delivery, now);

  // 내 차 위치 — GPS 를 켜 뒀으면 실제 좌표, 아니면 경로 위를 달리는 가짜 차
  const pos = useMemo(
    () => getPosition(delivery, db.truckLocations, now),
    [delivery, db.truckLocations, now],
  );

  const queue = siteQueue(db, delivery, now);

  const [tracking, setTracking] = useState(false);
  /** 운행 중에 상세를 펼쳐 봤나 */
  const [detail, setDetail] = useState(false);
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
      aside={
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {order?.urgent && <Tag tone="bad">긴급</Tag>}
          <Tag tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Tag>
        </span>
      }
      style={{ borderWidth: tracking ? 2 : 1, borderColor: tracking ? 'var(--color-rust)' : undefined }}
    >
      {order?.urgent && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="bad" title="긴급 배차입니다">
            {order.urgentReason ?? '현장이 타설 공백을 겪고 있습니다.'} 바로 출발해 주세요.
          </Alert>
        </div>
      )}

      {/*
        네비게이션 — 기사가 가장 먼저 보는 것.
        운행 중에는 지도를 크게 잡는다. 운전석에서 보는 화면이라 작은 카드로는
        길이 안 읽힌다.
      */}
      {site && (
        <Nav
          delivery={delivery}
          pos={pos}
          site={site}
          plant={plant}
          now={now}
          driving={tracking || phase === 'transit'}
          height={navMode ? 400 : 280}
        />
      )}

      {/* 현장 도착 대기 — 가서 바로 부을 수 있나 */}
      {phase !== 'done' && <ArrivalQueue delivery={delivery} queue={queue} now={now} />}

      {/*
        운행 중에는 상세를 접는다. 운전하면서 읽을 것은 남은 거리·시간·도착뿐이고,
        차량번호나 사양은 출발 전에 이미 본 것이다. 다만 진입 메모와 타설 기한은
        운전 중에도 쓰이므로 접어 두지 않는다.
      */}
      {navMode && (
        <>
          <Row label="타설 기한">
            {clock(delivery.limitAt)}{' '}
            <Tag tone={DeliveryRules.limitLevel(delivery, now)}>
              {limitRemaining(delivery.limitAt, delivery.etaCurrentAt, now)}
            </Tag>
          </Row>
          {site?.accessNote && <Row label="진입 메모">{site.accessNote}</Row>}
        </>
      )}

      {(!navMode || detail) && (
        <>
          <Row label="차량">
            {truck?.plateNo} · {truck?.driver}
          </Row>
          <Row label="공장">{plant?.name}</Row>
          <Row label="현장">{site?.address}</Row>
          {!navMode && site?.accessNote && <Row label="진입 메모">{site.accessNote}</Row>}
          <Row label="적재">{m3(delivery.volumeM3)}</Row>
          {order && <Row label="사양">{specText(order.spec)}</Row>}
          <Row label="비비기 시작">{clock(delivery.mixStartAt)}</Row>
          <Row label="도착 예상">{clock(delivery.etaCurrentAt)}</Row>
          {!navMode && (
            <Row label="타설 기한">
              {clock(delivery.limitAt)}{' '}
              <Tag tone={DeliveryRules.limitLevel(delivery, now)}>
                {limitRemaining(delivery.limitAt, delivery.etaCurrentAt, now)}
              </Tag>
            </Row>
          )}
          <Row label="이동">
            {duration(delivery.travelMinutes)} · {delivery.distanceKm}km
          </Row>
        </>
      )}

      {navMode && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ flex: 1 }}
            onClick={() => setDetail((v) => !v)}
            aria-expanded={detail}
          >
            {detail ? '상세 접기' : '배송 상세 보기'}
          </button>
          {onShowList && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={onShowList}>
              전체 목록
            </button>
          )}
        </div>
      )}

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

      {/* 현장 도착 후 — 종이 납품서를 찍어 두고 완료한다 */}
      {(phase === 'onsite' || delivery.notePhotoPath) && (
        <div style={{ marginTop: 14 }}>
          <PhotoInput
            kind="note"
            path={notePath(delivery.id, profile?.id ?? 'demo')}
            savedPath={delivery.notePhotoPath}
            label="납품서(송장) 사진"
            height={200}
            hint="현장 서명이 들어간 종이 납품서를 찍어 두세요. 글씨가 읽혀야 증빙이 됩니다."
            onSaved={(p) => saveNotePhoto(delivery.id, p)}
            onRemoved={() => saveNotePhoto(delivery.id, undefined)}
          />
        </div>
      )}

      {phase === 'onsite' && (
        <button
          type="button"
          className="btn btn-primary btn-block"
          style={{ marginTop: 4 }}
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

/* ==========================================================================
 * 내 정보 — 기사 등록
 *
 * 현장에 처음 가는 기사는 게이트에서 신원을 확인받는다. 얼굴 사진이 있으면
 * 현장이 누가 오는지 미리 안다.
 *
 * ⚠ 얼굴 사진은 개인정보다 (지시서 11장). 동의 없이 올리게 하지 않고, 왜 쓰는지
 *   적고, 언제든 지울 수 있게 둔다. 저장소는 비공개이고 볼 때마다 몇 분짜리
 *   서명 주소를 새로 발급한다 — 주소가 새어도 나중에는 열리지 않는다.
 * ======================================================================== */

function MyProfile() {
  const { demoMode, profile, updateProfile } = useAuth();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [consent, setConsent] = useState(!!profile?.photoPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!profile) return null;

  async function savePhone() {
    setBusy(true);
    setError(null);
    try {
      await updateProfile({ phone: phone.trim() });
    } catch (e) {
      setError(failure(e, '연락처를 저장하지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="내 정보"
      aside={
        profile.photoPath ? <Tag tone="ok">사진 등록됨</Tag> : <Tag tone="muted">사진 없음</Tag>
      }
    >
      <Row label="이름">{profile.name}</Row>
      <Row label="연락처">{profile.phone || '없음'}</Row>

      {!open ? (
        <button
          type="button"
          className="btn btn-outline btn-sm btn-block"
          style={{ marginTop: 12 }}
          onClick={() => setOpen(true)}
        >
          내 정보 고치기
        </button>
      ) : (
        <div style={{ marginTop: 14 }}>
          <label className="field">
            <span className="label">연락처</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                type="tel"
                value={phone}
                maxLength={20}
                placeholder="예) 010-0000-0000"
                onChange={(e) => setPhone(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-outline"
                style={{ flex: 'none' }}
                disabled={busy}
                onClick={() => void savePhone()}
              >
                저장
              </button>
            </div>
            <span style={{ fontSize: '0.76rem', color: 'var(--color-concrete-mid)' }}>
              현장이 급할 때 이 번호로 전화합니다.
            </span>
          </label>

          <label
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              fontSize: '0.84rem',
              lineHeight: 1.55,
              cursor: 'pointer',
              margin: '4px 0 12px',
            }}
          >
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              style={{ width: 18, height: 18, marginTop: 2, flex: 'none' }}
            />
            <span>
              현장 게이트에서 <strong>본인 확인</strong>에 쓰도록 얼굴 사진을 올리는 것에
              동의합니다. 사진은 내가 배송하는 현장과 소속 레미콘사만 볼 수 있고, 언제든 지울 수
              있습니다.
            </span>
          </label>

          <PhotoInput
            kind="face"
            path={facePath(profile.id)}
            savedPath={profile.photoPath}
            label="얼굴 사진"
            disabled={!consent}
            hint={
              consent
                ? '얼굴이 잘 보이게, 밝은 곳에서 찍어 주세요. 안 올려도 배송에는 지장이 없습니다.'
                : '동의해야 올릴 수 있습니다.'
            }
            onSaved={(p) => updateProfile({ photoPath: p })}
            onRemoved={() => updateProfile({ photoPath: null })}
          />

          {error && (
            <p style={{ fontSize: '0.82rem', color: 'var(--color-bad)', margin: '0 0 8px' }}>
              {error}
            </p>
          )}

          <button
            type="button"
            className="btn btn-ghost btn-sm btn-block"
            onClick={() => setOpen(false)}
          >
            닫기
          </button>

          {demoMode && (
            <p
              style={{ fontSize: '0.76rem', color: 'var(--color-concrete-mid)', margin: '8px 0 0' }}
            >
              시연 모드라 사진은 이 브라우저에만 저장됩니다.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ==========================================================================
 * 차량 등록 — 차량번호를 직접 넣는다
 *
 * 보통은 레미콘사가 차량을 등록해 두지만, 새로 들어온 차나 임차 차량은
 * 기사가 먼저 도착하는 일이 있다. 그때 여기서 넣고 바로 자기 앞으로 가져간다.
 * ======================================================================== */

function NewTruckForm({ plantIds }: { plantIds: string[] }) {
  const db = useDb();
  const [open, setOpen] = useState(false);
  const [plantId, setPlantId] = useState(plantIds[0] ?? '');
  const [plateNo, setPlateNo] = useState('');
  const [capacity, setCapacity] = useState(String(TRUCK_CAPACITY_M3));
  const [busy, setBusy] = useState(false);
  // 같은 프레임의 두 번째 클릭을 막는다 — setState 는 다음 렌더에야 버튼을 잠근다
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const plants = db.plants.filter((p) => plantIds.includes(p.id));
  const cap = Number(capacity);

  /** [가정] 국내 차량번호 — "경기 80바 1234" 또는 "80바 1234" */
  const plateOk = /^(\S+\s)?\d{2,3}[가-힣]\s?\d{4}$/.test(plateNo.trim());

  const problem = !plantId
    ? '소속 공장을 고르세요'
    : !plateOk
      ? '차량번호를 "경기 80바 1234" 형식으로 적어 주세요'
      : !(cap > 0 && cap <= 12)
        ? '적재량을 0 초과 12m³ 이하로 적어 주세요'
        : null;

  async function save() {
    if (busyRef.current || problem) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await createTruck({ plantId, plateNo: plateNo.trim(), capacityM3: cap, claim: true });
      setOpen(false);
      setPlateNo('');
    } catch (e) {
      setError(failure(e, '차량을 등록하지 못했습니다.'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (plants.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-outline btn-block btn-sm"
        style={{ marginTop: 12 }}
        onClick={() => setOpen(true)}
      >
        내 차량 직접 등록하기
      </button>
    );
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        background: 'var(--color-paper)',
        border: '1px solid var(--color-line-strong)',
        borderRadius: 'var(--radius-sharp)',
      }}
    >
      <label className="field">
        <span className="label">소속 공장</span>
        <select className="select" value={plantId} onChange={(e) => setPlantId(e.target.value)}>
          {plants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="label">차량번호</span>
        <input
          className="input"
          value={plateNo}
          maxLength={20}
          placeholder="예) 경기 80바 1234"
          style={{ fontFamily: 'var(--font-mono)' }}
          onChange={(e) => setPlateNo(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="label">적재량 (m³)</span>
        <input
          className="input"
          type="number"
          inputMode="decimal"
          min={1}
          max={12}
          step={0.5}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
        />
      </label>

      {error && (
        <p style={{ fontSize: '0.82rem', color: 'var(--color-bad)', margin: '0 0 8px' }}>{error}</p>
      )}
      {problem && !error && (
        <p style={{ fontSize: '0.82rem', color: 'var(--color-concrete-mid)', margin: '0 0 8px' }}>
          {problem}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-outline"
          style={{ flex: 'none' }}
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          취소
        </button>
        <button
          type="button"
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={!!problem || busy}
          onClick={() => void save()}
        >
          {busy ? '등록 중…' : '등록하고 내 차로'}
        </button>
      </div>

      <p style={{ fontSize: '0.76rem', color: 'var(--color-concrete-mid)', margin: '10px 0 0' }}>
        호차 번호는 그 공장에서 비어 있는 가장 작은 번호로 자동 부여됩니다.
      </p>
    </div>
  );
}

/* ==========================================================================
 * 현장 도착 대기
 *
 * 기사가 현장 앞에서 서 있는 시간은 그냥 기다리는 시간이 아니다. 그 사이에도
 * 비비기~타설 제한시간(90/120분)은 계속 흐른다. 그래서 "몇 분 기다리나"와
 * "기다리고 나면 기한이 남나"를 같이 보여 준다.
 * ======================================================================== */

function ArrivalQueue({
  delivery,
  queue,
  now,
}: {
  delivery: Delivery;
  queue: ReturnType<typeof siteQueue>;
  now: number;
}) {
  const arrived = delivery.arriveAt != null && delivery.arriveAt <= now;
  // 기다린 뒤 하역을 마쳤을 때 기한까지 남는 시간
  const slackMin = Math.round(
    (delivery.limitAt - (queue.unloadStartAt + UNLOAD_EST_MIN * MIN)) / MIN,
  );

  return (
    <div style={{ marginBottom: 12 }}>
      <StatGrid min={96}>
        <Stat
          label={arrived ? '내 앞 대기' : '도착 시 내 앞'}
          value={queue.ahead}
          unit="대"
          tone={queue.ahead === 0 ? 'ok' : queue.ahead >= 2 ? 'warn' : 'muted'}
          hint={queue.aheadOnSite > 0 ? `현장에 ${queue.aheadOnSite}대 있음` : '현장 비어 있음'}
        />
        <Stat
          label="하역 시작"
          value={clock(queue.unloadStartAt)}
          tone={queue.waitMin > 0 ? 'warn' : 'ok'}
          hint={queue.unloadStartAt > now ? `${remaining(queue.unloadStartAt, now)} 뒤` : '지금'}
        />
        <Stat
          label="대기 시간"
          value={queue.waitMin}
          unit="분"
          tone={queue.waitMin === 0 ? 'ok' : queue.waitMin >= 15 ? 'bad' : 'warn'}
          hint="도착 후 기다리는 시간"
        />
      </StatGrid>

      {slackMin < 0 && (
        <div style={{ marginTop: 10 }}>
          <Alert tone="bad" title={`이대로면 타설 기한을 ${-slackMin}분 넘깁니다`}>
            줄을 서 있는 동안에도 비비기~타설 제한시간은 흐릅니다. 현장 담당자에게 순서를 앞당길
            수 있는지 확인하세요.
          </Alert>
        </div>
      )}
      {slackMin >= 0 && queue.waitMin >= 15 && (
        <div style={{ marginTop: 10 }}>
          <Alert tone="warn" title={`현장에서 ${queue.waitMin}분 기다릴 것으로 보입니다`}>
            하역을 마쳐도 기한까지 {slackMin}분 남습니다. 도착 전에 현장에 연락해 두면 좋습니다.
          </Alert>
        </div>
      )}
    </div>
  );
}
