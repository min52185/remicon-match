'use client';

/**
 * 긴급주문 — AI 가 지금 가장 빨리 오는 공장을 골라 바로 보낸다.
 *
 * 두 자리에서 같은 부품을 쓴다.
 *   주문 화면    사양을 직접 고른다 (basis 없음)
 *   현황판      진행 중인 주문의 사양을 그대로 쓴다 (basis 있음) — 다른 사양을
 *              부으면 그게 더 큰 사고다
 *
 * 공장을 사람이 고르게 하지 않는다. 긴급은 분 단위로 다투는데, 목록을 훑어
 * 비교하는 동안 이미 늦는다. 대신 왜 그 공장인지를 숫자로 보여 준다 —
 * "준비 5분 + 이동 25분 = 30분 뒤 도착".
 *
 * 매칭이 안 되면 그냥 실패로 끝내지 않는다. 이유별로 몇 곳이 걸렸는지 보여 주고
 * (사양 불가 3곳 · 시간 초과 5곳), 그래도 보내겠다면 직접 고를 수 있게 연다.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Empty, Panel, Row, Tag } from './ui';
import SpecPicker from './SpecPicker';
import { matchFastest, type MatchCandidate, type MatchRoute } from '@/lib/ai/match';
import { clock, duration, failure, m3, remaining } from '@/lib/format';
import { DEFAULT_SPEC, TRUCK_CAPACITY_M3, specText } from '@/lib/rules';
import { getRoutesToSite } from '@/lib/services/route';
import { createOrder } from '@/lib/store';
import { useDb, useNow } from '@/lib/store/hooks';
import type { Order, Site, Spec } from '@/lib/types';

interface Props {
  site: Site;
  /**
   * 진행 중인 주문 — 있으면 사양·온도·펌프 속도를 여기서 가져오고 사양 선택을 감춘다.
   * 없으면(주문 화면) 사양을 직접 고른다.
   */
  basis?: Order;
  /** 기본 요청 대수 */
  defaultTrucks?: number;
  /** 사유 기본값 */
  defaultReason?: string;
  /** 접힌 상태의 버튼 문구 */
  label?: string;
  /** [가정] 사양을 직접 고를 때 쓸 외기온도 */
  tempC?: number;
}

export default function UrgentRequest({
  site,
  basis,
  defaultTrucks = 1,
  defaultReason = '',
  label = '긴급주문',
  tempC: tempProp,
}: Props) {
  const db = useDb();
  const now = useNow(5000);

  const [open, setOpen] = useState(false);
  const [trucks, setTrucks] = useState(Math.max(1, defaultTrucks));
  const [reason, setReason] = useState(defaultReason);
  const [spec, setSpec] = useState<Spec>(basis?.spec ?? DEFAULT_SPEC);
  const [specError, setSpecError] = useState<string | null>(null);

  const [routes, setRoutes] = useState<Map<string, MatchRoute>>(new Map());
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState(false);

  const [sending, setSending] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<{ name: string; phone: string; arriveAt: number } | null>(
    null,
  );

  const volumeM3 = trucks * TRUCK_CAPACITY_M3;
  const effectiveSpec = basis?.spec ?? spec;
  const effectiveTemp = basis?.tempC ?? tempProp ?? 20;

  // 펼칠 때만 길찾기를 부른다 — 공장 열두 곳이면 요청이 열두 번이다
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    getRoutesToSite(db.plants, site, Date.now())
      .then((r) => {
        if (!alive) return;
        setRoutes(
          new Map(
            [...r.entries()].map(([id, v]) => [
              id,
              { minutes: v.minutes, distanceKm: v.distanceKm, source: v.source },
            ]),
          ),
        );
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, db.plants, site]);

  const result = useMemo(
    () =>
      matchFastest({
        now: now || Date.now(),
        plants: db.plants,
        routes,
        spec: effectiveSpec,
        volumeM3,
        tempC: effectiveTemp,
      }),
    [now, db.plants, routes, effectiveSpec, volumeM3, effectiveTemp],
  );

  async function send(c: MatchCandidate) {
    if (busyRef.current) return;
    busyRef.current = true;
    setSending(c.plant.id);
    setError(null);
    try {
      await createOrder({
        siteId: site.id,
        plantId: c.plant.id,
        spec: effectiveSpec,
        volumeM3,
        // 긴급은 '지금 붓는다' — 타설 시각을 고르게 하지 않는다
        pourStartAt: Date.now(),
        pumpRate: basis?.pumpRate ?? 60,
        tempC: effectiveTemp,
        urgent: true,
        urgentReason: reason.trim() || '현장 긴급 요청',
      });
      setSentTo({
        name: c.plant.name,
        phone: c.plant.phone,
        arriveAt: c.arriveAt ?? Date.now(),
      });
      setOpen(false);
      setManual(false);
    } catch (e) {
      setError(failure(e, '긴급주문을 보내지 못했습니다.'));
    } finally {
      busyRef.current = false;
      setSending(null);
    }
  }

  /* ── 보낸 뒤 ── */
  if (sentTo && !open) {
    return (
      <Panel style={{ borderWidth: 2, borderColor: 'var(--color-ok)' }}>
        <Alert tone="ok" title={`${sentTo.name} 에 긴급주문을 보냈습니다`}>
          도착 예상 <strong>{clock(sentTo.arriveAt)}</strong>. 공장이 수락하면 배송 추적에 뜹니다.
          급한 건이니 전화로도 확인하세요 — {sentTo.phone || '번호 없음'}
        </Alert>
        <button
          type="button"
          className="btn btn-outline btn-sm btn-block"
          style={{ marginTop: 12 }}
          onClick={() => {
            setSentTo(null);
            setOpen(true);
          }}
        >
          한 대 더 요청하기
        </button>
      </Panel>
    );
  }

  /* ── 접힘 ── */
  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-primary btn-block"
        style={{ marginTop: 12 }}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
    );
  }

  /* ── 펼침 ── */
  return (
    <Panel
      title="긴급주문"
      aside={<Tag tone="bad">지금 출발</Tag>}
      style={{ borderWidth: 2, borderColor: 'var(--color-rust)' }}
    >
      {basis ? (
        <>
          <Row label="사양">{specText(basis.spec)}</Row>
          <Row label="외기온도">{basis.tempC}℃</Row>
          <p style={{ fontSize: '0.78rem', color: 'var(--color-concrete-mid)', margin: '6px 0 12px' }}>
            지금 붓고 있는 주문과 같은 사양입니다. 다른 사양을 부으면 그게 더 큰 사고입니다.
          </p>
        </>
      ) : (
        <div style={{ marginBottom: 6 }}>
          <SpecPicker spec={spec} onChange={setSpec} onInvalid={setSpecError} />
        </div>
      )}

      <label className="field">
        <span className="label">필요 대수 ({m3(volumeM3)})</span>
        <input
          type="number"
          className="input"
          min={1}
          max={10}
          value={trucks}
          onChange={(e) => setTrucks(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
        />
      </label>

      <label className="field">
        <span className="label">사유 — 공장 화면에 그대로 보입니다</span>
        <textarea
          className="input"
          rows={2}
          value={reason}
          style={{ resize: 'vertical' }}
          placeholder="예) 펌프 고장으로 타설이 멈췄습니다"
          onChange={(e) => setReason(e.target.value)}
        />
      </label>

      {error && (
        <p style={{ fontSize: '0.82rem', color: 'var(--color-bad)', margin: '0 0 8px' }}>{error}</p>
      )}

      {specError ? (
        <Empty>사양을 먼저 확인해 주세요.</Empty>
      ) : loading ? (
        <Empty>공장별 준비시간과 실시간 교통을 계산하는 중…</Empty>
      ) : result.best && !manual ? (
        <BestMatch
          best={result.best}
          runnerUp={result.usable[1]}
          now={now}
          sending={sending === result.best.plant.id}
          onSend={() => void send(result.best!)}
          onManual={() => setManual(true)}
        />
      ) : (
        <NoMatch
          result={result}
          now={now}
          sending={sending}
          manual={manual}
          onSend={send}
          onBack={() => setManual(false)}
        />
      )}

      <button
        type="button"
        className="btn btn-ghost btn-sm btn-block"
        style={{ marginTop: 10 }}
        onClick={() => setOpen(false)}
      >
        닫기
      </button>
    </Panel>
  );
}

/* ==========================================================================
 * 매칭 성공 — 왜 이 공장인지를 숫자로 보여 준다
 * ======================================================================== */

function BestMatch({
  best,
  runnerUp,
  now,
  sending,
  onSend,
  onManual,
}: {
  best: MatchCandidate;
  runnerUp?: MatchCandidate;
  now: number;
  sending: boolean;
  onSend: () => void;
  onManual: () => void;
}) {
  return (
    <>
      <div
        style={{
          padding: 12,
          background: 'var(--color-paper)',
          border: '2px solid var(--color-rust)',
          borderRadius: 'var(--radius-sharp)',
          marginBottom: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
          <Tag tone="accent">AI 매칭</Tag>
          <strong style={{ fontSize: '1rem' }}>{best.plant.name}</strong>
        </div>

        <Row label="도착 예상">
          <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem' }}>
            {clock(best.arriveAt ?? 0)}
          </strong>{' '}
          <span style={{ fontWeight: 400, fontSize: '0.8rem', color: 'var(--color-concrete-mid)' }}>
            {remaining(best.arriveAt ?? 0, now)} 뒤
          </span>
        </Row>
        <Row label="계산">
          준비 {best.prepMinutes}분 + 이동 {best.travelMinutes}분 ={' '}
          <strong>{duration(best.etaMinutes ?? 0)}</strong>
        </Row>
        <Row label="거리">
          {best.route?.distanceKm}km{best.route?.source === 'approx' && ' · 근사값'}
        </Row>
        {best.reason && (
          <p style={{ fontSize: '0.8rem', color: 'var(--color-warn)', margin: '8px 0 0' }}>
            {best.reason}
          </p>
        )}
      </div>

      {runnerUp && (
        <p style={{ fontSize: '0.78rem', color: 'var(--color-concrete-mid)', margin: '0 0 10px' }}>
          다음으로 빠른 곳은 {runnerUp.plant.name} — {duration(runnerUp.etaMinutes ?? 0)}{' '}
          (
          {(runnerUp.etaMinutes ?? 0) - (best.etaMinutes ?? 0) > 0
            ? `${(runnerUp.etaMinutes ?? 0) - (best.etaMinutes ?? 0)}분 늦음`
            : '같음'}
          )
        </p>
      )}

      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={sending}
        onClick={onSend}
      >
        {sending ? '보내는 중…' : `${best.plant.name} 에 긴급주문 보내기`}
      </button>

      <button
        type="button"
        className="btn btn-ghost btn-sm btn-block"
        style={{ marginTop: 6 }}
        onClick={onManual}
      >
        다른 공장에서 고르기
      </button>
    </>
  );
}

/* ==========================================================================
 * 매칭 실패 — 왜 안 되는지 보여 주고, 그래도 보내겠다면 직접 고르게
 * ======================================================================== */

function NoMatch({
  result,
  now,
  sending,
  manual,
  onSend,
  onBack,
}: {
  result: ReturnType<typeof matchFastest>;
  now: number;
  sending: string | null;
  manual: boolean;
  onSend: (c: MatchCandidate) => void;
  onBack: () => void;
}) {
  const list = manual ? [...result.usable, ...result.blocked] : result.blocked;

  return (
    <>
      {!manual && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="bad" title="지금 갈 수 있는 공장이 없습니다">
            아래 이유로 전부 걸렀습니다. 대수를 줄이거나 사양을 낮추면 달라질 수 있습니다.
          </Alert>
          <ul
            style={{
              listStyle: 'none',
              margin: '10px 0 0',
              padding: 0,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
            }}
          >
            {result.reasons.map((r) => (
              <li key={r.reason}>
                <Tag tone="muted">
                  {r.reason} {r.count}곳
                </Tag>
              </li>
            ))}
          </ul>
          <p style={{ fontSize: '0.78rem', color: 'var(--color-concrete-mid)', margin: '10px 0 0' }}>
            허용 이동시간은 {result.allowedTravelMinutes}분입니다. 이보다 먼 공장은 도착해도 제한
            시간 안에 못 붓습니다.
          </p>
        </div>
      )}

      {manual && (
        <p style={{ fontSize: '0.82rem', color: 'var(--color-concrete-wet)', margin: '0 0 10px' }}>
          빠른 순입니다. <strong>보낼 수 없는 공장</strong>은 이유가 붙어 있고 버튼이 잠겨
          있습니다.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.slice(0, 6).map((c) => (
          <div
            key={c.plant.id}
            style={{
              padding: 10,
              background: 'var(--color-paper)',
              border: '1px solid var(--color-line)',
              borderRadius: 'var(--radius-sharp)',
              opacity: c.ok ? 1 : 0.6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              <strong style={{ fontSize: '0.88rem' }}>{c.plant.name}</strong>
              <span style={{ marginLeft: 'auto' }}>
                <Tag tone={c.level}>
                  {c.etaMinutes != null ? `${duration(c.etaMinutes)} 뒤` : '—'}
                </Tag>
              </span>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--color-concrete-mid)', margin: '0 0 8px' }}>
              {c.etaMinutes != null
                ? `준비 ${c.prepMinutes}분 + 이동 ${c.travelMinutes}분`
                : '이동시간 계산 중'}
              {c.arriveAt != null && ` · ${clock(c.arriveAt)} 도착`}
              {c.reason && ` · ${c.reason}`}
            </p>
            <button
              type="button"
              className={`btn btn-sm btn-block ${c.ok ? 'btn-primary' : 'btn-outline'}`}
              disabled={!c.ok || sending != null}
              onClick={() => onSend(c)}
            >
              {sending === c.plant.id
                ? '보내는 중…'
                : c.ok
                  ? '이 공장에 보내기'
                  : '보낼 수 없음'}
            </button>
          </div>
        ))}
      </div>

      {manual && (
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-block"
          style={{ marginTop: 8 }}
          onClick={onBack}
        >
          AI 매칭으로 돌아가기
        </button>
      )}

      {/* now 는 남은 시간 표시에 쓰인다 — 값이 바뀌면 다시 그려야 한다 */}
      <span hidden>{now}</span>
    </>
  );
}
