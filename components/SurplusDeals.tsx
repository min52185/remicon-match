'use client';

/**
 * 현장 주문 화면 — 급처 매물.
 *
 * 공장이 싸게 내놓은 '이미 비빈 레미콘'을 보여 준다. 시계가 이미 돌고 있으니
 * 현장마다 "지금 받으면 제한시간 안에 닿는가"를 따로 판정한다. 못 닿는 매물은
 * 싸도 뒤로 보내고 받기를 잠근다 — 늦게 온 레미콘은 공짜여도 못 쓴다.
 *
 * 받기는 두 번 누른다. 누르는 순간 그 공장으로 주문이 가기 때문이다.
 */

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { clock, duration, failure, m3, won } from '@/lib/format';
import { SURPLUS, specText } from '@/lib/rules';
import { simClock } from '@/lib/services/clock';
import { getRoutesToSite, type RouteResult } from '@/lib/services/route';
import { SurplusGoneError, claimSurplus } from '@/lib/store';
import { useDb, useNow } from '@/lib/store/hooks';
import { REASON_LABEL, claimNote, isLive, offersForSite, type SurplusOffer } from '@/lib/surplus';
import type { Order, Site } from '@/lib/types';
import { Alert, Panel, Tag } from './ui';

export default function SurplusDeals({ site }: { site: Site }) {
  const db = useDb();
  const now = useNow(15_000);
  const [routes, setRoutes] = useState<Map<string, RouteResult>>(new Map());
  const [claimed, setClaimed] = useState<Order | null>(null);

  // 매물이 있는 공장만 경로를 묻는다 — 공장 전부를 물으면 길찾기 호출이 낭비된다
  const plantIds = useMemo(
    () =>
      [...new Set(db.surplus.filter((l) => now && isLive(l, now)).map((l) => l.plantId))]
        .sort()
        .join(','),
    [db.surplus, now],
  );

  useEffect(() => {
    if (!plantIds) return;
    const ids = new Set(plantIds.split(','));
    let alive = true;
    getRoutesToSite(
      db.plants.filter((p) => ids.has(p.id)),
      site,
      simClock.now(),
    ).then((r) => alive && setRoutes(r));
    return () => {
      alive = false;
    };
    // 공장 목록 배열은 갱신마다 새로 만들어진다 — id 묶음이 바뀔 때만 다시 묻는다
  }, [plantIds, site]);

  const offers = now
    ? offersForSite(db.surplus, db.plants, now, (p) => routes.get(p.id)?.minutes)
    : [];

  if (offers.length === 0 && !claimed) return null;

  return (
    <Panel
      title="급처 매물"
      aside={offers.length > 0 ? <Tag tone="accent">{offers.length}건</Tag> : undefined}
      style={{ borderColor: 'var(--color-rust)', borderWidth: 2 }}
    >
      <p style={{ fontSize: '0.85rem', margin: '0 0 12px', lineHeight: 1.6 }}>
        공장이 이미 비빈 레미콘을 정상가보다 <strong>최소 {SURPLUS.MIN_DISCOUNT_PCT}% 싸게</strong>{' '}
        내놓았습니다. 비비기부터 시계가 돌고 있어서, 지금 받으면 제한시간 안에 닿는 매물만 받을 수
        있습니다.
      </p>

      {claimed && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="ok" title={`매물을 가져왔습니다 — 주문 ${claimed.code}`}>
            {db.plants.find((p) => p.id === claimed.plantId)?.name}에 긴급 주문으로 보냈습니다.
            공장이 수락하면 바로 출발합니다.{' '}
            <Link href="/site/tracking" style={{ color: 'var(--color-rust)' }}>
              배송 추적 →
            </Link>
          </Alert>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {offers.map((o) => (
          <OfferCard key={o.listing.id} offer={o} site={site} now={now} onClaimed={setClaimed} />
        ))}
      </div>
    </Panel>
  );
}

function OfferCard({
  offer: o,
  site,
  now,
  onClaimed,
}: {
  offer: SurplusOffer;
  site: Site;
  now: number;
  onClaimed: (order: Order) => void;
}) {
  const l = o.listing;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // 같은 틱의 두 번째 클릭을 막는다 — 같은 매물로 주문이 두 건 가지 않게
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const memo = claimNote(l, site);
      const order = await claimSurplus(
        l.id,
        site.id,
        {
          siteId: site.id,
          plantId: l.plantId,
          spec: l.spec,
          volumeM3: l.volumeM3,
          pourStartAt: o.arriveAt,
          pumpRate: SURPLUS.CLAIM_PUMP_RATE,
          tempC: l.tempC,
          urgent: true,
          urgentReason: memo.urgentReason,
          note: memo.note,
          // 공장이 이미 비벼 둔 것이다. 배차할 때 이 시각부터 제한시간을 재야
          // 한다 — 지금 비비기 시작한 것으로 찍으면 없는 여유가 생긴다.
          surplusId: l.id,
          mixStartedAt: l.mixStartAt,
        },
        now,
      );
      onClaimed(order);
    } catch (e) {
      setError(
        e instanceof SurplusGoneError ? e.message : failure(e, '매물을 가져오지 못했습니다.'),
      );
      setConfirming(false);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <article
      className="card"
      style={{ padding: 12, opacity: o.reachable ? 1 : 0.6 }}
      aria-label={`${o.plant.name} 급처 매물`}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '0.95rem' }}>{o.plant.name}</strong>
        <Tag>{REASON_LABEL[l.reason]}</Tag>
        <span style={{ marginLeft: 'auto' }}>
          <Tag tone="accent">{l.discountPct}% 할인</Tag>
        </span>
      </div>

      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', margin: '6px 0 0' }}>
        {specText(l.spec)} · {m3(l.volumeM3)}
      </p>

      <p style={{ fontSize: '0.92rem', margin: '6px 0 0' }}>
        <s style={{ color: 'var(--color-concrete-mid)' }}>{won(l.unitPrice)}</s>{' '}
        <strong style={{ color: 'var(--color-rust)', fontFamily: 'var(--font-mono)' }}>
          {won(o.unitPrice)}
        </strong>
        <span style={{ fontSize: '0.8rem' }}>/m³</span>{' '}
        <span style={{ fontSize: '0.8rem', color: 'var(--color-concrete-wet)' }}>
          · 총 {won(o.total)} ({won(o.saved)} 절약)
        </span>
      </p>

      <p style={{ fontSize: '0.8rem', color: 'var(--color-concrete-wet)', margin: '6px 0 0' }}>
        비비기 {clock(l.mixStartAt)} · 지금 받으면 {duration(o.travelMinutes)} 뒤{' '}
        {clock(o.arriveAt)} 도착 ·{' '}
        {o.reachable ? (
          <Tag tone={o.slackMinutes < 15 ? 'warn' : 'ok'}>여유 {duration(o.slackMinutes)}</Tag>
        ) : (
          <Tag tone="bad">제한시간 안에 못 옴</Tag>
        )}
      </p>
      {l.note && (
        <p style={{ fontSize: '0.78rem', color: 'var(--color-concrete-mid)', margin: '4px 0 0' }}>
          {l.note}
        </p>
      )}

      {o.reachable &&
        (confirming ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => void claim()}
            >
              {busy ? '보내는 중…' : `${won(o.total)}에 받기 확정`}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              취소
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{ marginTop: 10 }}
            onClick={() => setConfirming(true)}
          >
            이 매물 받기
          </button>
        ))}

      {error && (
        <p style={{ color: 'var(--color-bad)', fontSize: '0.8rem', margin: '6px 0 0' }}>{error}</p>
      )}
    </article>
  );
}
