'use client';

/**
 * 현장 — 주문하기.
 *
 * 사양·물량·타설 시각을 넣으면 "이 조건으로 지금 보낼 수 있는 공장"만 남긴다.
 * 판정은 셋을 겹쳐 본다: 공장이 그 사양을 만들 수 있는가 / 물량이 되는가 /
 * 비비기~타설 제한시간 안에 도착하는가.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import KakaoMap, { type MapMarker } from '@/components/KakaoMap';
import { SiteShell } from '@/components/RoleShells';
import SpecPicker from '@/components/SpecPicker';
import { Empty, MockNotice, Panel, Row, Tag } from '@/components/ui';
import { duration, failure, fromLocalInput, m3, toLocalInput } from '@/lib/format';
import {
  DEFAULT_POUR_SETTINGS,
  DEFAULT_SPEC,
  MIN,
  PourRules,
  TRUCK_CAPACITY_M3,
  specText,
} from '@/lib/rules';
import { simClock } from '@/lib/services/clock';
import { getRoutesToSite, type RouteResult } from '@/lib/services/route';
import { getTemperature } from '@/lib/services/weather';
import { bumpFavorite, createOrder, favoritesOfSite, saveFavorite } from '@/lib/store';
import { useDb, useMounted } from '@/lib/store/hooks';
import type { Judgement, Level, Order, Plant, Site, Spec } from '@/lib/types';

export default function OrderPage() {
  return (
    <SiteShell
      title="레미콘 주문하기"
      description="사양과 타설 시각을 넣으면 제한시간 안에 도착할 수 있는 공장만 남습니다."
    >
      {(site) => <OrderBody site={site} />}
    </SiteShell>
  );
}

/** 기본 타설 시각 — 지금부터 2시간 뒤, 30분 단위로 맞춘다 */
function defaultPourStart() {
  const t = simClock.now() + 2 * 60 * MIN;
  const d = new Date(t);
  d.setMinutes(d.getMinutes() >= 30 ? 30 : 0, 0, 0);
  return d.getTime();
}

function OrderBody({ site }: { site: Site }) {
  const db = useDb();
  const mounted = useMounted();

  const [spec, setSpec] = useState<Spec>(DEFAULT_SPEC);
  const [volumeM3, setVolumeM3] = useState(60);
  const [pumpRate, setPumpRate] = useState(40);
  const [pourStartAt, setPourStartAt] = useState<number>(0);
  const [tempC, setTempC] = useState<number | null>(null);
  const [tempSource, setTempSource] = useState<string>('');
  const [manualTemp, setManualTemp] = useState(false);

  const [routes, setRoutes] = useState<Map<string, RouteResult>>(new Map());
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Order | null>(null);
  const [favAlias, setFavAlias] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // 마운트 뒤에 시각을 정한다 (서버·클라이언트 시각이 달라 생기는 경고 방지)
  useEffect(() => {
    if (!pourStartAt) setPourStartAt(defaultPourStart());
  }, [pourStartAt]);

  // 외기온도 — 타설 시각 기준. 현장이 직접 넣으면 그 값이 우선이다.
  useEffect(() => {
    if (manualTemp || !pourStartAt) return;
    let alive = true;
    getTemperature(site, pourStartAt).then((t) => {
      if (!alive) return;
      setTempC(t.tempC);
      setTempSource(t.source === 'kma' ? '기상청 단기예보' : '평년값 근사 [가정]');
    });
    return () => {
      alive = false;
    };
  }, [site, pourStartAt, manualTemp]);

  // 공장별 이동시간·경로
  useEffect(() => {
    if (!pourStartAt) return;
    let alive = true;
    setLoadingRoutes(true);
    getRoutesToSite(db.plants, site, pourStartAt)
      .then((r) => alive && setRoutes(r))
      .finally(() => alive && setLoadingRoutes(false));
    return () => {
      alive = false;
    };
  }, [db.plants, site, pourStartAt]);

  const limitMin = tempC == null ? null : PourRules.limitMinutes(tempC);
  const allowedMin = tempC == null ? null : PourRules.allowedTravelMinutes(tempC, DEFAULT_POUR_SETTINGS);

  /** 공장별 판정 — 가장 나쁜 것이 그 공장의 등급이 된다 */
  const rated = useMemo(() => {
    if (allowedMin == null) return [];
    return db.plants
      .map((plant) => {
        const route = routes.get(plant.id);
        const supply = PourRules.judgeSupply(plant, volumeM3, spec);
        const travel: Judgement | null = route
          ? PourRules.judgeTravel(route.minutes, allowedMin)
          : null;
        const level = PourRules.worst(supply.level, travel?.level ?? 'ok');
        return { plant, route, supply, travel, level };
      })
      .sort((a, b) => {
        const rank = { ok: 0, warn: 1, bad: 2 } as const;
        return (
          rank[a.level] - rank[b.level] ||
          (a.route?.minutes ?? 999) - (b.route?.minutes ?? 999)
        );
      });
  }, [db.plants, routes, volumeM3, spec, allowedMin]);

  const selected = rated.find((r) => r.plant.id === selectedId) ?? null;
  const truckCount = Math.ceil(volumeM3 / TRUCK_CAPACITY_M3);

  const markers: MapMarker[] = [
    { id: site.id, lat: site.lat, lng: site.lng, kind: 'site', label: '현장', tone: 'accent' },
    ...rated.map((r) => ({
      id: r.plant.id,
      lat: r.plant.lat,
      lng: r.plant.lng,
      kind: 'plant' as const,
      label: `${r.plant.name.replace('레미콘 ', ' ')} ${r.route ? `${r.route.minutes}분` : ''}`.trim(),
      tone: r.level,
      selected: r.plant.id === selectedId,
      onClick: () => setSelectedId(r.plant.id),
    })),
  ];

  const paths = selected?.route ? [{ id: 'sel', points: selected.route.path, emphasis: true }] : [];

  async function order() {
    if (!selected || tempC == null) return;
    setSending(true);
    setSendError(null);
    try {
      const o = await createOrder({
        siteId: site.id,
        plantId: selected.plant.id,
        spec,
        volumeM3,
        pourStartAt,
        pumpRate,
        tempC,
      });
      setPlaced(o);
      setFavAlias('');
    } catch (e) {
      setSendError(failure(e, '주문을 보내지 못했습니다.'));
    } finally {
      setSending(false);
    }
  }

  async function keepAsFavorite() {
    if (!placed) return;
    try {
      await saveFavorite({
        siteId: site.id,
        alias: favAlias.trim() || specText(spec),
        spec,
        volumeM3,
        pumpRate,
        preferredPlantId: placed.plantId,
      });
      setFavAlias('');
      setPlaced(null);
    } catch (e) {
      setSendError(failure(e, '즐겨찾기를 저장하지 못했습니다.'));
    }
  }

  const favorites = favoritesOfSite(db, site.id);

  if (!mounted || !pourStartAt) return <Empty>불러오는 중…</Empty>;

  return (
    <>
      <MockNotice />

      {/* 주문 직후 — 즐겨찾기에 저장 (지시서 5장 ★) */}
      {placed && (
        <Panel
          title="주문을 보냈습니다"
          style={{ borderColor: 'var(--color-rust)', borderWidth: 2 }}
        >
          <Row label="주문번호">{placed.code}</Row>
          <Row label="공장">{db.plants.find((p) => p.id === placed.plantId)?.name}</Row>
          <Row label="사양">{specText(placed.spec)}</Row>
          <Row label="물량">{m3(placed.volumeM3)}</Row>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-concrete-wet)', margin: '12px 0 8px' }}>
            이 조합을 다음에도 쓰시겠습니까? 저장해 두면 카드 한 번으로 주문서가 채워집니다.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: '1 1 180px' }}
              placeholder="예: 2층 슬래브용"
              value={favAlias}
              onChange={(e) => setFavAlias(e.target.value)}
            />
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void keepAsFavorite()}>
              즐겨찾기에 저장
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlaced(null)}>
              나중에
            </button>
          </div>
          <p style={{ fontSize: '0.82rem', marginTop: 12, marginBottom: 0 }}>
            <Link href="/site/tracking" style={{ color: 'var(--color-rust)' }}>
              배송 추적으로 가기 →
            </Link>
          </p>
        </Panel>
      )}

      {/* 즐겨찾기 빠른 선택 */}
      {favorites.length > 0 && (
        <Panel title="즐겨찾기에서 불러오기">
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
            {favorites.map((f) => (
              <button
                key={f.id}
                type="button"
                className="card card-pad"
                style={{
                  flex: 'none',
                  width: 200,
                  textAlign: 'left',
                  cursor: 'pointer',
                  padding: 12,
                }}
                onClick={() => {
                  setSpec(f.spec);
                  setVolumeM3(f.volumeM3);
                  setPumpRate(f.pumpRate);
                  if (f.preferredPlantId) setSelectedId(f.preferredPlantId);
                  void bumpFavorite(f.id);
                }}
              >
                <strong style={{ display: 'block', fontSize: '0.92rem' }}>{f.alias}</strong>
                <span
                  style={{
                    display: 'block',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.78rem',
                    color: 'var(--color-concrete-wet)',
                    marginTop: 4,
                  }}
                >
                  {specText(f.spec)} · {m3(f.volumeM3)}
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--color-concrete-mid)' }}>
                  {f.useCount}회 사용
                </span>
              </button>
            ))}
          </div>
        </Panel>
      )}

      {/* 사양 */}
      <Panel title="레미콘 사양">
        <SpecPicker spec={spec} onChange={setSpec} />
      </Panel>

      {/* 물량·시각 */}
      <Panel title="물량과 타설 시각">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <label className="field">
            <span className="label">총 물량 (m³)</span>
            <input
              type="number"
              className="input"
              min={1}
              step={1}
              value={volumeM3}
              onChange={(e) => setVolumeM3(Math.max(1, Number(e.target.value) || 0))}
            />
          </label>
          <label className="field">
            <span className="label">펌프 타설 속도 (m³/h)</span>
            <input
              type="number"
              className="input"
              min={5}
              step={5}
              value={pumpRate}
              onChange={(e) => setPumpRate(Math.max(5, Number(e.target.value) || 0))}
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
            <span className="label">
              외기온도 (℃) {manualTemp ? '· 직접 입력' : `· ${tempSource}`}
            </span>
            <input
              type="number"
              className="input"
              step={0.5}
              value={tempC ?? ''}
              onChange={(e) => {
                setManualTemp(true);
                setTempC(Number(e.target.value));
              }}
            />
          </label>
        </div>

        {tempC != null && limitMin != null && allowedMin != null && (
          <div style={{ marginTop: 6 }}>
            <Row label="차량 수">
              {truckCount}대 · 1대 {TRUCK_CAPACITY_M3}m³ [가정]
            </Row>
            <Row label="도착 간격">
              {duration((TRUCK_CAPACITY_M3 / pumpRate) * 60)} 마다 한 대
            </Row>
            <Row label="제한시간">
              비비기~타설 완료 {limitMin}분{' '}
              <Tag tone={PourRules.isHot(tempC) ? 'warn' : 'info'}>
                외기 {tempC}℃ · {PourRules.isHot(tempC) ? '25℃ 이상' : '25℃ 미만'}
              </Tag>
            </Row>
            <Row label="허용 이동시간">
              {allowedMin}분{' '}
              <span style={{ color: 'var(--color-concrete-mid)', fontWeight: 400, fontSize: '0.8rem' }}>
                = {limitMin} − 준비 {DEFAULT_POUR_SETTINGS.prepMinutes} − 현장{' '}
                {DEFAULT_POUR_SETTINGS.siteBufferMinutes} − 여유{' '}
                {DEFAULT_POUR_SETTINGS.safetyMarginMinutes}
              </span>
            </Row>
            {volumeM3 > TRUCK_CAPACITY_M3 * 12 && (
              <p style={{ fontSize: '0.84rem', marginTop: 12, marginBottom: 0 }}>
                물량이 많습니다({truckCount}대).{' '}
                <Link href="/site/allocate" style={{ color: 'var(--color-rust)', fontWeight: 600 }}>
                  AI 배분으로 여러 공장에 나눠 주문하기 →
                </Link>
              </p>
            )}
          </div>
        )}
      </Panel>

      {/* 지도 */}
      <Panel
        title="공장 찾기"
        aside={loadingRoutes ? <Tag tone="muted">이동시간 계산 중…</Tag> : undefined}
      >
        <KakaoMap markers={markers} paths={paths} height={320} />
      </Panel>

      {/* 공장 목록 */}
      <Panel title={`주문 가능한 공장 ${rated.filter((r) => r.level !== 'bad').length}곳`}>
        {rated.length === 0 ? (
          <Empty>조건을 먼저 입력해 주세요.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rated.map((r) => (
              <PlantRow
                key={r.plant.id}
                plant={r.plant}
                route={r.route}
                supply={r.supply}
                travel={r.travel}
                level={r.level}
                selected={r.plant.id === selectedId}
                onSelect={() => setSelectedId(r.plant.id)}
              />
            ))}
          </div>
        )}
      </Panel>

      {/* 주문 */}
      <div className="sticky-cta">
        {sendError && (
          <p style={{ fontSize: '0.82rem', color: 'var(--color-bad)', margin: '0 0 8px' }}>{sendError}</p>
        )}
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={!selected || selected.level === 'bad' || tempC == null || sending}
          onClick={() => void order()}
        >
          {sending
            ? '보내는 중…'
            : selected
              ? `${selected.plant.name}에 ${m3(volumeM3)} 주문하기`
              : '공장을 골라 주세요'}
        </button>
        {selected?.level === 'warn' && (
          <p
            style={{
              fontSize: '0.8rem',
              color: 'var(--color-warn)',
              textAlign: 'center',
              margin: '8px 0 0',
            }}
          >
            {selected.supply.level === 'warn' ? selected.supply.label : selected.travel?.label} —
            공장과 통화로 확인하고 주문하세요.
          </p>
        )}
      </div>
    </>
  );
}

function PlantRow({
  plant,
  route,
  supply,
  travel,
  level,
  selected,
  onSelect,
}: {
  plant: Plant;
  route?: RouteResult;
  supply: Judgement;
  travel: Judgement | null;
  level: Level;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="card"
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: 12,
        cursor: 'pointer',
        borderColor: selected ? 'var(--color-rust)' : undefined,
        borderWidth: selected ? 2 : 1,
        opacity: level === 'bad' ? 0.6 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <strong style={{ fontSize: '0.95rem' }}>{plant.name}</strong>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
          {route ? `${route.minutes}분` : '—'}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <Tag tone={supply.level}>{supply.label}</Tag>
        {travel && <Tag tone={travel.level}>{travel.label}</Tag>}
        {travel?.margin != null && travel.level !== 'bad' && (
          <span style={{ fontSize: '0.75rem', color: 'var(--color-concrete-mid)' }}>
            여유 {travel.margin}분
          </span>
        )}
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '0.75rem',
            color: 'var(--color-concrete-mid)',
          }}
        >
          {route ? `${route.distanceKm}km` : ''} · 가용 {plant.availableTrucks}대 /{' '}
          {plant.availableVolume}m³ · 시간당 {plant.hourlyRate}대
          {route?.source === 'approx' && ' · 근사'}
        </span>
      </div>
      {route?.delayReason && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-warn)', margin: '6px 0 0' }}>
          {route.delayReason}
        </p>
      )}
    </button>
  );
}
