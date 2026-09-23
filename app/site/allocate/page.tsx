'use client';

/**
 * 현장 — 대량 타설 AI 배분 (지시서 6장).
 *
 * 300m³(50대)를 한 공장이 다 대지 못할 때, 거리·이동시간·시간당 출하 능력을 함께 풀어
 * 공장별 대수와 회차별 출하 시각표를 낸다. 확정하면 공장별 주문을 한 번에 보낸다.
 *
 * 화면에 "가까운 공장부터 채우는 단순 방식"과 나란히 보여 주는 이유는,
 * 이 기능이 왜 필요한지가 그 비교에서만 드러나기 때문이다.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import KakaoMap, { type MapMarker } from '@/components/KakaoMap';
import { SiteShell } from '@/components/RoleShells';
import SpecPicker from '@/components/SpecPicker';
import { Empty, MockNotice, Panel, Row, Tag } from '@/components/ui';
import { clock, duration, fromLocalInput, m3, toLocalInput } from '@/lib/format';
import type { AllocationResult, NaiveResult } from '@/lib/ai/allocate';
import {
  DEFAULT_POUR_SETTINGS,
  DEFAULT_SPEC,
  MIN,
  PourRules,
  TRUCK_CAPACITY_M3,
  specText,
} from '@/lib/rules';
import { simClock } from '@/lib/services/clock';
import { getRoutesToSite } from '@/lib/services/route';
import { getTemperature } from '@/lib/services/weather';
import { createOrdersFromPlan } from '@/lib/store';
import { useDb, useMounted } from '@/lib/store/hooks';
import type { AllocationPlan, Site, Spec } from '@/lib/types';

export default function AllocatePage() {
  return (
    <SiteShell
      title="대량 타설 AI 배분"
      description="여러 공장에 몇 대씩 나눠야 끊김없이 타설되는지 계산합니다."
      showClock={false}
    >
      {(site) => <AllocateBody site={site} />}
    </SiteShell>
  );
}

function defaultPourStart() {
  const d = new Date(simClock.now() + 3 * 60 * MIN);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

/**
 * 지시서 6장의 A~G 예시. 발표에서 "왜 AI 배분이 필요한가"를 보여 주는 입력이다.
 * 이 입력이면 단순 방식은 중간에 끊기고, 최적화는 A5·B4·C10·D5·E12·F14·G0 으로 끝까지 채운다.
 * 같은 수치가 tests/allocate.test.ts 에 고정돼 있다.
 */
const EXAMPLE_PLANTS = [
  { id: 'A', name: 'A공장', availableTrucks: 5, hourlyRate: 4, travelMinutes: 15 },
  { id: 'B', name: 'B공장', availableTrucks: 4, hourlyRate: 4, travelMinutes: 20 },
  { id: 'C', name: 'C공장', availableTrucks: 10, hourlyRate: 4, travelMinutes: 25 },
  { id: 'D', name: 'D공장', availableTrucks: 5, hourlyRate: 4, travelMinutes: 30 },
  { id: 'E', name: 'E공장', availableTrucks: 12, hourlyRate: 4, travelMinutes: 35 },
  { id: 'F', name: 'F공장', availableTrucks: 20, hourlyRate: 4, travelMinutes: 45 },
  { id: 'G', name: 'G공장', availableTrucks: 25, hourlyRate: 4, travelMinutes: 60 },
];

function AllocateBody({ site }: { site: Site }) {
  const db = useDb();
  const mounted = useMounted();

  const [totalVolumeM3, setTotalVolumeM3] = useState(300);
  const [pumpRate, setPumpRate] = useState(60);
  const [pourStartAt, setPourStartAt] = useState(0);
  const [tempC, setTempC] = useState(28);
  const [safetyMarginMinutes, setSafety] = useState(DEFAULT_POUR_SETTINGS.safetyMarginMinutes);
  const [spec, setSpec] = useState<Spec>(DEFAULT_SPEC);
  const [showSpec, setShowSpec] = useState(false);

  const [result, setResult] = useState<AllocationResult | null>(null);
  const [naive, setNaive] = useState<NaiveResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState(0);
  /** 지시서 6장 A~G 예시로 계산할지 — 발표용 */
  const [useExample, setUseExample] = useState(false);

  useEffect(() => {
    if (!pourStartAt) setPourStartAt(defaultPourStart());
  }, [pourStartAt]);

  useEffect(() => {
    if (!pourStartAt) return;
    let alive = true;
    getTemperature(site, pourStartAt).then((t) => alive && setTempC(t.tempC));
    return () => {
      alive = false;
    };
  }, [site, pourStartAt]);

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    setNaive(null);
    setSentCount(0);

    try {
      // 1) 공장별 이동시간 — 타설 시각에 출발한다고 보고 구한다
      //    (예시 모드에서는 지시서에 적힌 가정치를 그대로 쓴다)
      let plants: {
        id: string;
        name: string;
        availableTrucks: number;
        hourlyRate: number;
        travelMinutes?: number;
      }[] = EXAMPLE_PLANTS;

      if (!useExample) {
        const routes = await getRoutesToSite(db.plants, site, pourStartAt);
        plants = db.plants
          .filter((p) => p.isOpen)
          .map((p) => ({
            id: p.id,
            name: p.name,
            availableTrucks: p.availableTrucks,
            hourlyRate: p.hourlyRate,
            travelMinutes: routes.get(p.id)?.minutes,
          }));
      }

      // 2) 배분 풀기
      const res = await fetch('/api/ai/allocate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          totalVolumeM3,
          pumpRate,
          pourStartAt,
          tempC,
          truckCapacityM3: TRUCK_CAPACITY_M3,
          settings: { ...DEFAULT_POUR_SETTINGS, safetyMarginMinutes },
          site: { lat: site.lat, lng: site.lng },
          plants,
        }),
      });

      if (!res.ok) throw new Error(`서버 응답 ${res.status}`);
      const json = (await res.json()) as { result: AllocationResult; naive?: NaiveResult };
      setResult(json.result);
      setNaive(json.naive ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '계산에 실패했습니다.');
    } finally {
      setRunning(false);
    }
  }

  function sendOrders() {
    if (!result?.feasible) return;
    const plan: AllocationPlan = {
      id: `pl${Date.now().toString(36)}`,
      siteId: site.id,
      totalVolumeM3,
      pourStartAt,
      pumpRate,
      tempC,
      items: result.items.map((i) => ({
        plantId: i.plantId,
        plantName: i.plantName,
        trucks: i.trucks,
        travelMinutes: i.travelMinutes,
        rounds: i.rounds,
        mixStartAts: i.mixStartAts,
      })),
      summary: result.message,
      createdAt: Date.now(),
    };
    const orders = createOrdersFromPlan(plan, {
      siteId: site.id,
      spec,
      pourStartAt,
      pumpRate,
      tempC,
    });
    setSentCount(orders.length);
  }

  const markers: MapMarker[] = [
    { id: site.id, lat: site.lat, lng: site.lng, kind: 'site', label: '현장', tone: 'accent' },
    ...db.plants.map((p) => {
      const item = result?.items.find((i) => i.plantId === p.id);
      const out = result?.excluded.find((e) => e.plantId === p.id);
      return {
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        kind: 'plant' as const,
        label: item ? `${p.name.split(' ')[0]} ${item.trucks}대` : p.name.split(' ')[0],
        tone: item ? ('ok' as const) : out ? ('bad' as const) : ('muted' as const),
        selected: !!item,
      };
    }),
  ];

  if (!mounted || !pourStartAt) return <Empty>불러오는 중…</Empty>;

  return (
    <>
      <MockNotice />

      <Panel title="타설 조건">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 12,
          }}
        >
          <label className="field">
            <span className="label">총 물량 (m³)</span>
            <input
              type="number"
              className="input"
              min={6}
              step={6}
              value={totalVolumeM3}
              onChange={(e) => setTotalVolumeM3(Math.max(6, Number(e.target.value) || 0))}
            />
          </label>
          <label className="field">
            <span className="label">펌프 속도 (m³/h)</span>
            <input
              type="number"
              className="input"
              min={10}
              step={5}
              value={pumpRate}
              onChange={(e) => setPumpRate(Math.max(10, Number(e.target.value) || 0))}
            />
          </label>
          <label className="field">
            <span className="label">타설 시작</span>
            <input
              type="datetime-local"
              className="input"
              value={toLocalInput(pourStartAt)}
              onChange={(e) => setPourStartAt(fromLocalInput(e.target.value))}
            />
          </label>
          <label className="field">
            <span className="label">외기온도 (℃)</span>
            <input
              type="number"
              className="input"
              step={0.5}
              value={tempC}
              onChange={(e) => setTempC(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span className="label">안전 여유 (분)</span>
            <input
              type="number"
              className="input"
              min={0}
              step={5}
              value={safetyMarginMinutes}
              onChange={(e) => setSafety(Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
        </div>

        <Row label="필요 대수">
          {Math.ceil(totalVolumeM3 / TRUCK_CAPACITY_M3)}대 · 1대 {TRUCK_CAPACITY_M3}m³ [가정]
        </Row>
        <Row label="도착 간격">{duration((TRUCK_CAPACITY_M3 / pumpRate) * 60)}</Row>
        <Row label="제한시간">
          {PourRules.limitMinutes(tempC)}분{' '}
          <Tag tone={PourRules.isHot(tempC) ? 'warn' : 'info'}>
            {PourRules.isHot(tempC) ? '25℃ 이상' : '25℃ 미만'}
          </Tag>
        </Row>
        <Row label="허용 이동시간">
          {PourRules.allowedTravelMinutes(tempC, { ...DEFAULT_POUR_SETTINGS, safetyMarginMinutes })}분
        </Row>

        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowSpec((v) => !v)}
            style={{ paddingLeft: 0 }}
          >
            {showSpec ? '▾' : '▸'} 레미콘 사양 — {specText(spec)}
          </button>
          {showSpec && (
            <div style={{ marginTop: 12 }}>
              <SpecPicker spec={spec} onChange={setSpec} />
            </div>
          )}
        </div>

        {/* 발표용 — 지시서 6장 예시 재현 */}
        <label
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            fontSize: '0.83rem',
            lineHeight: 1.5,
            cursor: 'pointer',
            marginTop: 14,
            padding: 10,
            background: 'var(--color-paper)',
            border: '1px solid var(--color-line)',
            borderRadius: 'var(--radius-sharp)',
          }}
        >
          <input
            type="checkbox"
            checked={useExample}
            onChange={(e) => {
              setUseExample(e.target.checked);
              setResult(null);
              setNaive(null);
              if (e.target.checked) {
                setTotalVolumeM3(300);
                setPumpRate(60);
                setTempC(28);
                setSafety(10);
              }
            }}
            style={{ width: 18, height: 18, marginTop: 2, flex: 'none' }}
          />
          <span>
            <strong>지시서 6장 A~G 예시로 계산</strong>
            <br />
            주변 공장을 A~G 일곱 곳(이동 15·20·25·30·35·45·60분)으로 두고 300m³를 푼다. 단순
            방식이 왜 끊기는지 한눈에 보인다. 이동시간은 지시서의 가정치라 지도와 무관하다.
          </span>
        </label>

        <button
          type="button"
          className="btn btn-primary btn-block"
          style={{ marginTop: 16 }}
          onClick={run}
          disabled={running}
        >
          {running ? '계산 중…' : 'AI 배분 계산하기'}
        </button>
      </Panel>

      {error && (
        <Panel>
          <p style={{ color: 'var(--color-bad)', margin: 0, fontSize: '0.9rem' }}>{error}</p>
        </Panel>
      )}

      {result && (
        <>
          <Panel
            title="배분 결과"
            aside={
              result.feasible ? <Tag tone="ok">연속 타설 가능</Tag> : <Tag tone="bad">배분 불가</Tag>
            }
          >
            <p style={{ fontSize: '0.9rem', margin: '0 0 14px' }}>{result.message}</p>

            <Row label="필요 대수">{result.trucksNeeded}대</Row>
            <Row label="도착 간격">{result.intervalMinutes.toFixed(1)}분</Row>
            <Row label="타설 예정">
              {clock(result.pourStartAt)} ~ {clock(result.pourEndAt)}
            </Row>
            {result.feasible && (
              <Row label="이동시간 합">
                {result.totalTravelMinutes}분{' '}
                <span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--color-concrete-mid)' }}>
                  (최소화한 목적함수 값)
                </span>
              </Row>
            )}

            {result.feasible && (
              <div style={{ overflowX: 'auto', marginTop: 14 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>공장</th>
                      <th className="num">이동</th>
                      <th className="num">추천</th>
                      <th>출하 시간대</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((i) => (
                      <tr key={i.plantId}>
                        <td>{i.plantName}</td>
                        <td className="num">{Math.round(i.travelMinutes)}분</td>
                        <td className="num">
                          <strong>{i.trucks}대</strong>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                          {clock(Math.min(...i.mixStartAts))} ~ {clock(Math.max(...i.mixStartAts))}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td>
                        <strong>합계</strong>
                      </td>
                      <td className="num" />
                      <td className="num">
                        <strong>{result.items.reduce((s, i) => s + i.trucks, 0)}대</strong>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--color-concrete-mid)' }}>
                        {m3(totalVolumeM3)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {result.excluded.length > 0 && (
              <details style={{ marginTop: 14, fontSize: '0.84rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--color-concrete-wet)' }}>
                  제외된 공장 {result.excluded.length}곳
                </summary>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--color-concrete-wet)' }}>
                  {result.excluded.map((e) => (
                    <li key={e.plantId}>
                      {e.plantName} — {e.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Panel>

          {/* 왜 AI 가 필요한가 */}
          {naive && (
            <Panel title="가까운 공장부터 채우면 어떻게 되나">
              {naive.brokeAtRound == null ? (
                <p style={{ fontSize: '0.9rem', margin: 0 }}>
                  이 조건에서는 단순 방식으로도 끝까지 채울 수 있습니다. 다만 이동시간 합은 AI
                  배분이 더 짧습니다.
                </p>
              ) : (
                <>
                  <p style={{ fontSize: '0.9rem', margin: '0 0 10px' }}>
                    가까운 공장부터 순서대로 채우면{' '}
                    <strong style={{ color: 'var(--color-bad)' }}>
                      {naive.brokeAtRound + 1}번째 차 ({clock(naive.brokeAtTime!)} 도착 예정)
                    </strong>{' '}
                    에서 보낼 공장이 없습니다. 가까운 공장을 먼저 다 쓰면 후반에 먼 공장만 남고, 그
                    공장들의 시간당 출하 능력 합이 필요한 속도를 못 따라가기 때문입니다.
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Tag tone="bad">단순 방식 {naive.filled}대에서 중단</Tag>
                    <Tag tone="ok">AI 배분 {result.trucksNeeded}대 연속</Tag>
                  </div>
                  <p
                    style={{
                      fontSize: '0.82rem',
                      color: 'var(--color-concrete-wet)',
                      margin: '10px 0 0',
                    }}
                  >
                    AI 배분은 먼 공장을 첫 시간부터 섞어 씁니다. 그래야 어느 60분 구간에서도 필요한
                    대수를 맞출 수 있습니다.
                  </p>
                </>
              )}
            </Panel>
          )}

          {/* 불가일 때의 대안 */}
          {!result.feasible && result.alternatives.length > 0 && (
            <Panel title="대신 이렇게 하면 됩니다">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {result.alternatives.map((a, i) => (
                  <div
                    key={i}
                    style={{
                      paddingLeft: 12,
                      borderLeft: '2px solid var(--color-rust)',
                    }}
                  >
                    <strong style={{ fontSize: '0.9rem', display: 'block' }}>{a.label}</strong>
                    <span style={{ fontSize: '0.84rem', color: 'var(--color-concrete-wet)' }}>
                      {a.detail}
                    </span>
                    {a.pumpRate && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        style={{ marginTop: 8 }}
                        onClick={() => {
                          setPumpRate(a.pumpRate!);
                          setResult(null);
                        }}
                      >
                        이 값으로 바꾸기
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {!useExample && (
            <Panel title="공장 위치와 배정">
              <KakaoMap markers={markers} height={320} />
            </Panel>
          )}

          {useExample && (
            <Panel>
              <p style={{ fontSize: '0.85rem', margin: 0, color: 'var(--color-concrete-wet)' }}>
                예시 모드입니다. A~G는 지도에 없는 가상의 공장이라 주문을 보낼 수 없습니다. 실제
                주문은 체크를 풀고 다시 계산하세요.
              </p>
            </Panel>
          )}

          {result.feasible && !useExample && (
            <div className="sticky-cta">
              {sentCount > 0 ? (
                <div className="card card-pad" style={{ borderColor: 'var(--color-ok)' }}>
                  <p style={{ margin: 0, fontSize: '0.9rem' }}>
                    {sentCount}개 공장에 주문을 보냈습니다. 각 공장이 수락하면 배차가 시작됩니다.
                  </p>
                  <p style={{ margin: '8px 0 0', fontSize: '0.85rem' }}>
                    <Link href="/site/tracking" style={{ color: 'var(--color-rust)' }}>
                      배송 추적으로 가기 →
                    </Link>
                  </p>
                </div>
              ) : (
                <button type="button" className="btn btn-primary btn-block" onClick={sendOrders}>
                  {result.items.length}개 공장에 주문 한 번에 보내기
                </button>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
