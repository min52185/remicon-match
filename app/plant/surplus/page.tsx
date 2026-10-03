'use client';

/**
 * 레미콘사 — 급처 매물.
 *
 * 현장이 주문을 취소했거나 출하하고 남은 레미콘을 싸게 내놓는다. 이미 비빈
 * 레미콘이라 그냥 두면 버려야 한다. 올리면 모든 현장의 주문 화면에 뜨고,
 * 제한시간 안에 닿을 수 있는 현장이 가져가면 이 공장으로 긴급 주문이 들어온다.
 */

import { useEffect, useRef, useState } from 'react';
import { PlantShell } from '@/components/RoleShells';
import SpecPicker from '@/components/SpecPicker';
import { Alert, ChipGroup, Empty, MockNotice, Panel, Row, Tag } from '@/components/ui';
import { clock, failure, fromLocalInput, m3, remaining, toLocalInput, won } from '@/lib/format';
import { DEFAULT_SPEC, PourRules, SURPLUS, TRUCK_CAPACITY_M3, specText } from '@/lib/rules';
import { simClock } from '@/lib/services/clock';
import { getTemperature } from '@/lib/services/weather';
import { createSurplus, withdrawSurplus } from '@/lib/store';
import { useDb, useMounted, useNow } from '@/lib/store/hooks';
import {
  REASON_LABEL,
  isLive,
  mustArriveBy,
  surplusOfPlant,
  surplusPrice,
  surplusTotal,
  validateSurplus,
} from '@/lib/surplus';
import type { Plant, Spec, SurplusListing, SurplusReason } from '@/lib/types';

export default function PlantSurplusPage() {
  return (
    <PlantShell
      title="급처 매물"
      description="취소되거나 남은 레미콘을 싸게 내놓습니다. 올리면 현장 주문 화면에 바로 뜹니다."
    >
      {(plant) => <SurplusBody plant={plant} />}
    </PlantShell>
  );
}

function SurplusBody({ plant }: { plant: Plant }) {
  const db = useDb();
  const mounted = useMounted();
  const now = useNow(15_000);
  const mine = surplusOfPlant(db.surplus, plant.id);
  const live = mine.filter((l) => isLive(l, now));
  const done = mine.filter((l) => !isLive(l, now));

  if (!mounted || !now) return <Empty>불러오는 중…</Empty>;

  return (
    <>
      <MockNotice />
      <NewListingForm plant={plant} />

      <Panel title={`올려 둔 매물 ${live.length}건`}>
        {live.length === 0 ? (
          <Empty>지금 올려 둔 매물이 없습니다.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {live.map((l) => (
              <ListingCard key={l.id} listing={l} now={now} />
            ))}
          </div>
        )}
      </Panel>

      {done.length > 0 && (
        <Panel title="지난 매물">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {done.slice(0, 10).map((l) => (
              <ListingCard key={l.id} listing={l} now={now} />
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

/* ==========================================================================
 * 올리기
 * ======================================================================== */

function NewListingForm({ plant }: { plant: Plant }) {
  const [reason, setReason] = useState<SurplusReason>('cancelled');
  const [spec, setSpec] = useState<Spec>(DEFAULT_SPEC);
  const [specError, setSpecError] = useState<string | null>(null);
  const [volumeM3, setVolumeM3] = useState(TRUCK_CAPACITY_M3);
  const [mixStartAt, setMixStartAt] = useState(0);
  const [unitPrice, setUnitPrice] = useState<number>(SURPLUS.DEFAULT_UNIT_PRICE_WON);
  const [discountPct, setDiscountPct] = useState<number>(SURPLUS.DEFAULT_DISCOUNT_PCT);
  const [note, setNote] = useState('');
  const [tempC, setTempC] = useState<number | null>(null);

  const [busy, setBusy] = useState(false);
  // 같은 틱의 두 번째 클릭을 막는다 — 같은 매물이 두 번 올라가지 않게
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<SurplusListing | null>(null);

  // 기본값: 지금 막 비빈 것으로 본다. 화면을 연 뒤에 정해야 서버·브라우저 시각이 어긋나지 않는다.
  useEffect(() => {
    if (!mixStartAt) setMixStartAt(simClock.now());
  }, [mixStartAt]);

  // 제한시간(90/120분)은 비빈 시각의 외기온도로 정한다
  useEffect(() => {
    if (!mixStartAt) return;
    let alive = true;
    getTemperature(plant, mixStartAt).then((t) => alive && setTempC(t.tempC));
    return () => {
      alive = false;
    };
  }, [plant, mixStartAt]);

  const limitMinutes = tempC == null ? null : PourRules.limitMinutes(tempC);
  const invalid = mixStartAt
    ? (specError ?? validateSurplus({ volumeM3, unitPrice, discountPct, mixStartAt }, simClock.now()))
    : null;
  const price = surplusPrice(unitPrice, discountPct);
  const total = surplusTotal({ unitPrice, discountPct, volumeM3 });

  async function submit() {
    if (busyRef.current || invalid || limitMinutes == null || tempC == null) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const l = await createSurplus({
        plantId: plant.id,
        reason,
        spec,
        volumeM3,
        mixStartAt,
        limitMinutes,
        tempC,
        unitPrice,
        discountPct,
        note: note.trim() || undefined,
      });
      setPosted(l);
      setNote('');
      setMixStartAt(simClock.now());
    } catch (e) {
      setError(failure(e, '매물을 올리지 못했습니다.'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (!mixStartAt) return null;

  return (
    <Panel title="급처 매물 올리기">
      {posted && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="ok" title="매물을 올렸습니다">
            {specText(posted.spec)} · {m3(posted.volumeM3)} — 현장 주문 화면에 지금 뜹니다.
            누가 가져가면 주문 관리에 긴급 주문으로 들어옵니다.
          </Alert>
        </div>
      )}

      <ChipGroup
        label="왜 급처하나요"
        options={['cancelled', 'leftover'] as SurplusReason[]}
        value={reason}
        onChange={setReason}
        format={(r) => REASON_LABEL[r]}
      />

      <div style={{ margin: '12px 0' }}>
        <SpecPicker spec={spec} onChange={setSpec} onInvalid={setSpecError} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
        }}
      >
        <label className="field">
          <span className="label">물량 (m³)</span>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            min={0.5}
            max={TRUCK_CAPACITY_M3}
            step={0.5}
            value={volumeM3}
            onChange={(e) => setVolumeM3(Number(e.target.value))}
          />
        </label>
        <label className="field">
          <span className="label">비비기 시작</span>
          <input
            className="input"
            type="datetime-local"
            value={toLocalInput(mixStartAt)}
            onChange={(e) => e.target.value && setMixStartAt(fromLocalInput(e.target.value))}
          />
        </label>
        <label className="field">
          <span className="label">정상 단가 (원/m³)</span>
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            step={1000}
            value={unitPrice}
            onChange={(e) => setUnitPrice(Number(e.target.value))}
          />
        </label>
      </div>

      <div style={{ marginTop: 12 }}>
        <ChipGroup
          label={`할인율 (최소 ${SURPLUS.MIN_DISCOUNT_PCT}%)`}
          options={SURPLUS.DISCOUNT_OPTIONS}
          value={discountPct}
          onChange={setDiscountPct}
          format={(v) => `${v}%`}
        />
      </div>

      <label className="field" style={{ marginTop: 12 }}>
        <span className="label">메모 (선택)</span>
        <input
          className="input"
          placeholder="예: 2호차에 실려 있음, 바로 출발 가능"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      <div style={{ marginTop: 14 }}>
        <Row label="급처가">
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            <s style={{ color: 'var(--color-concrete-mid)', fontWeight: 400 }}>{won(unitPrice)}</s>{' '}
            → <strong style={{ color: 'var(--color-rust)' }}>{won(price)}</strong> /m³
          </span>
        </Row>
        <Row label="이 매물 전체">
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {won(total.total)} <span style={{ color: 'var(--color-concrete-mid)' }}>(현장 {won(total.saved)} 절약)</span>
          </span>
        </Row>
        <Row label="현장 도착 시한">
          {limitMinutes == null ? (
            '외기온도 확인 중…'
          ) : (
            <>
              {clock(mustArriveBy({ mixStartAt, limitMinutes }))}까지{' '}
              <span style={{ color: 'var(--color-concrete-mid)' }}>
                (비비기~타설 {limitMinutes}분, 외기 {tempC}℃)
              </span>
            </>
          )}
        </Row>
      </div>

      {(invalid || error) && (
        <p style={{ color: 'var(--color-bad)', fontSize: '0.85rem', margin: '10px 0 0' }}>
          {error ?? invalid}
        </p>
      )}

      <button
        type="button"
        className="btn btn-primary btn-block"
        style={{ marginTop: 14 }}
        disabled={busy || !!invalid || limitMinutes == null}
        onClick={() => void submit()}
      >
        {busy ? '올리는 중…' : '급처 매물 올리기'}
      </button>
    </Panel>
  );
}

/* ==========================================================================
 * 올려 둔 매물
 * ======================================================================== */

function ListingCard({ listing: l, now }: { listing: SurplusListing; now: number }) {
  const db = useDb();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = isLive(l, now);
  const { unit } = surplusTotal(l);
  const claimedSite = l.claimedSiteId ? db.sites.find((s) => s.id === l.claimedSiteId) : undefined;

  const status =
    l.status === 'claimed' ? (
      <Tag tone="ok">현장이 가져감</Tag>
    ) : l.status === 'withdrawn' ? (
      <Tag tone="muted">내림</Tag>
    ) : live ? (
      <Tag tone="accent">판매 중</Tag>
    ) : (
      <Tag tone="bad">시한 지남</Tag>
    );

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      await withdrawSurplus(l.id);
    } catch (e) {
      setError(failure(e, '매물을 내리지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card" style={{ padding: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.88rem' }}>
          {specText(l.spec)}
        </strong>
        <span style={{ fontSize: '0.85rem' }}>{m3(l.volumeM3)}</span>
        <Tag>{REASON_LABEL[l.reason]}</Tag>
        <span style={{ marginLeft: 'auto' }}>{status}</span>
      </div>
      <p style={{ fontSize: '0.82rem', color: 'var(--color-concrete-wet)', margin: '6px 0 0' }}>
        <span style={{ fontFamily: 'var(--font-mono)' }}>{won(unit)}</span>/m³ ({l.discountPct}% 할인) ·
        비비기 {clock(l.mixStartAt)} ·{' '}
        {l.status === 'claimed'
          ? `${claimedSite?.name ?? '현장'} · ${clock(l.claimedAt)}`
          : live
            ? `도착 시한 ${remaining(mustArriveBy(l), now)} 남음`
            : `도착 시한 ${clock(mustArriveBy(l))}`}
      </p>
      {l.note && (
        <p style={{ fontSize: '0.8rem', color: 'var(--color-concrete-mid)', margin: '4px 0 0' }}>
          {l.note}
        </p>
      )}
      {live && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 8 }}
          disabled={busy}
          onClick={() => void withdraw()}
        >
          매물 내리기
        </button>
      )}
      {error && (
        <p style={{ color: 'var(--color-bad)', fontSize: '0.8rem', margin: '6px 0 0' }}>{error}</p>
      )}
    </article>
  );
}
