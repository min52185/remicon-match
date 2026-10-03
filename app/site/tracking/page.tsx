'use client';

/**
 * 현장 — 배송 추적 + 타설 모니터.
 *
 * 한 화면에 둔 이유: 현장이 알고 싶은 것은 "차가 어디 있나"가 아니라
 * "타설이 끊기나"이기 때문이다. 공백 예측을 맨 위에, 차량은 그 아래에 둔다.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import KakaoMap, { type MapMarker, type MapPath } from '@/components/KakaoMap';
import TempNow from '@/components/TempNow';
import { SiteShell } from '@/components/RoleShells';
import { Empty, MockNotice, Panel, Row, Tag } from '@/components/ui';
import { analyzeDelay, monitorPour, recommend } from '@/lib/ai/predict';
import { clock, delayText, duration, limitRemaining, m3, remaining } from '@/lib/format';
import { splitPath } from '@/lib/geo';
import { DeliveryRules, MIN, PHASE_LABEL, PHASE_TONE, specText } from '@/lib/rules';
import { photoUrl } from '@/lib/services/photos';
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
          heading: t.pos.heading,
        };
      }),
  ];

  const paths: MapPath[] = tracked
    .filter((t) => !t.d.completedAt)
    .flatMap((t) => {
      // 지나온 길은 회색, 남은 길은 진한 색 — 진행이 마커 말고 선으로도 보이게
      const { done, rest } = splitPath(t.d.path, t.pos.progress);
      return [
        ...(done.length > 1 ? [{ id: `${t.d.id}-done`, points: done, dim: true }] : []),
        ...(rest.length > 1 ? [{ id: `${t.d.id}-rest`, points: rest, emphasis: true }] : []),
      ];
    });

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
          <Row label="타설 공백">
            {monitor.gapMinutes <= 0 ? '없음 (겹침)' : `${monitor.gapMinutes}분`}{' '}
            <span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--color-concrete-mid)' }}>
              타설이 멈추는 시간
            </span>
          </Row>
        )}
        {monitor.jointIntervalMin != null && (
          <Row label="이어치기 간격">
            <span
              style={{
                color:
                  monitor.jointSlackMin != null && monitor.jointSlackMin < 0
                    ? 'var(--color-bad)'
                    : undefined,
              }}
            >
              {monitor.jointIntervalMin}분 / 허용 {monitor.coldJointLimitMin}분
            </span>{' '}
            <span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--color-concrete-mid)' }}>
              {monitor.jointSlackMin != null && monitor.jointSlackMin >= 0
                ? `${monitor.jointSlackMin}분 남음`
                : `${-(monitor.jointSlackMin ?? 0)}분 초과`}
            </span>
          </Row>
        )}

        {/*
          기온은 제한시간을 정하는 값이다. 주문할 때 기록한 온도로 90분/120분이
          굳었는데, 타설은 몇 시간씩 이어진다. 그 사이 25℃ 를 넘나들면 처음 받은
          제한이 더 이상 안전하지 않으므로 지금 기온을 같이 보여 준다.
        */}
        <Row label="외기온도">
          <span style={{ fontFamily: 'var(--font-mono)' }}>{tempC}℃</span>{' '}
          <span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--color-concrete-mid)' }}>
            주문 시 기록 · 이어치기 한도 {monitor.coldJointLimitMin}분을 정한 값
          </span>
        </Row>
        <div style={{ padding: '6px 0' }}>
          <TempNow at={site} recordedC={tempC} />
        </div>

        <p style={{ fontSize: '0.74rem', color: 'var(--color-concrete-mid)', margin: '10px 0 0' }}>
          이어치기 간격은 KCS 14 20 10 표 3.3-1 의 정의(하층 비비기 시작 ~ 상층 타설)로 잽니다.
          타설 공백과는 다른 숫자입니다.
        </p>

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

      {/* 누가 오는지 — 게이트에서 본인 확인에 쓴다 */}
      {truck?.facePath && <DriverFace path={truck.facePath} name={truck.driver} />}

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
        <Tag tone={limitLevel}>{limitRemaining(d.limitAt, d.etaCurrentAt, now)}</Tag>
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
      {d.notePhotoPath && <NotePhoto path={d.notePhotoPath} />}

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

/* ==========================================================================
 * 사진 — 기사 얼굴과 납품서
 *
 * 비공개 저장소라 볼 때마다 짧게 사는 서명 주소를 새로 받는다. 경로가 바뀌면
 * 다시 받는다. 못 받으면 아무것도 그리지 않는다 — 사진이 없다고 배송에
 * 문제가 생기는 것은 아니다.
 * ======================================================================== */

function usePhotoUrl(kind: 'face' | 'note', path: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    photoUrl(kind, path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [kind, path]);
  return url;
}

function DriverFace({ path, name }: { path: string; name?: string }) {
  const url = usePhotoUrl('face', path);
  if (!url) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 8px' }}>
      {/* 기사가 올린 사진이라 크기를 알 수 없다 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`${name ?? '기사'} 얼굴 사진`}
        style={{
          width: 44,
          height: 44,
          objectFit: 'cover',
          borderRadius: '50%',
          border: '1px solid var(--color-line-strong)',
        }}
      />
      <span style={{ fontSize: '0.8rem', color: 'var(--color-concrete-wet)' }}>
        게이트에서 본인 확인에 쓰세요
      </span>
    </div>
  );
}

function NotePhoto({ path }: { path: string }) {
  const url = usePhotoUrl('note', path);
  const [open, setOpen] = useState(false);
  if (!url) return null;

  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        className="btn btn-outline btn-sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? '납품서 사진 접기' : '납품서 사진 보기'}
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="기사가 올린 종이 납품서"
            style={{
              width: '100%',
              border: '1px solid var(--color-line-strong)',
              borderRadius: 'var(--radius-sharp)',
            }}
          />
          <p style={{ fontSize: '0.76rem', color: 'var(--color-concrete-mid)', margin: '6px 0 0' }}>
            기사가 현장에서 찍어 올린 종이 납품서입니다.
          </p>
        </div>
      )}
    </div>
  );
}
