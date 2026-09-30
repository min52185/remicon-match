'use client';

/**
 * 레미콘사 — 공장 등록·수정.
 *
 * 이 서비스에 자기 공장을 올리려는 사람을 위한 화면이다. 등록하고 나면
 * 현장 검색에 뜨고 주문을 받을 수 있다.
 *
 * 등록 직후에는 '출하 중지' 상태로 둔다. 생산 능력만 적고 출하 가능 물량을
 * 아직 안 적은 공장이 현장 목록에 0m³ 로 떠 있으면 서로 시간만 버린다.
 * 출하 현황 화면에서 물량을 적고 중지를 풀어야 주문이 들어온다.
 */

import Link from 'next/link';
import { useState, useRef } from 'react';
import CapabilityForm, { EMPTY_CAPABILITY, validateCapability } from '@/components/CapabilityForm';
import LocationPicker, { type PickedLocation } from '@/components/LocationPicker';
import TruckListEditor, {
  emptyTruck,
  fillBlankPlates,
  validateTrucks,
  type TruckDraft,
} from '@/components/TruckListEditor';
import { PlantShell } from '@/components/RoleShells';
import { Alert, MockNotice, Panel, Row, Tag } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { failure } from '@/lib/format';
import { RULES, TRUCK_CAPACITY_M3 } from '@/lib/rules';
import {
  createPlant,
  createTruck,
  deleteTruck,
  store,
  updatePlantInfo,
  updateTruck,
} from '@/lib/store';
import { useDb } from '@/lib/store/hooks';
import type { Plant, PlantCapability } from '@/lib/types';

export default function PlantRegisterPage() {
  return (
    <PlantShell
      title="공장 등록"
      description="새 공장을 올리거나, 지금 고른 공장의 정보를 고칩니다."
      showClock={false}
      // 공장이 하나도 없으면 여기서 첫 공장을 만든다
      empty={() => <PlantForm onDone={() => window.location.reload()} first />}
    >
      {(plant) => <RegisterBody current={plant} />}
    </PlantShell>
  );
}

function RegisterBody({ current }: { current: Plant }) {
  const db = useDb();
  const { demoMode, profile } = useAuth();
  const [mode, setMode] = useState<'list' | 'new' | 'edit'>('list');

  const mine = demoMode
    ? db.plants
    : db.plants.filter((p) => !p.companyId || p.companyId === profile?.companyId);

  if (mode === 'new') return <PlantForm onDone={() => setMode('list')} />;
  if (mode === 'edit') return <PlantForm plant={current} onDone={() => setMode('list')} />;

  return (
    <>
      <MockNotice />

      <Panel title={`내 공장 ${mine.length}곳`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mine.map((p) => (
            <article
              key={p.id}
              className="card card-pad"
              style={{
                padding: 12,
                borderColor: p.id === current.id ? 'var(--color-rust)' : undefined,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <strong style={{ fontSize: '0.94rem' }}>{p.name}</strong>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {p.id === current.id && <Tag tone="accent">지금 보는 공장</Tag>}
                  {p.isOpen ? <Tag tone="ok">출하 중</Tag> : <Tag tone="bad">출하 중지</Tag>}
                </span>
              </div>
              <Row label="주소">{p.address || '주소 없음'}</Row>
              <Row label="좌표">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
                  {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                </span>
              </Row>
              <Row label="보유 차량">{p.fleetSize}대</Row>
              <Row label="생산 가능">
                {Object.entries(p.cap.maxStrength)
                  .map(([t, max]) => `${t} ${max}MPa`)
                  .join(' · ') || '아직 안 적음'}
              </Row>
            </article>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button
            type="button"
            className="btn btn-outline"
            style={{ flex: 1 }}
            onClick={() => setMode('edit')}
          >
            {current.name} 고치기
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => setMode('new')}
          >
            공장 추가
          </button>
        </div>
      </Panel>

      <Panel title="등록하면 어떻게 되나요">
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: '0.88rem', lineHeight: 1.75 }}>
          <li>공장 위치와 생산 가능 사양을 적습니다.</li>
          <li>
            등록 직후에는 <strong>출하 중지</strong> 상태입니다 — 현장 목록에 아직 뜨지 않습니다.
          </li>
          <li>
            <Link href="/plant" style={{ color: 'var(--color-rust)' }}>
              출하 현황
            </Link>
            에서 지금 내보낼 수 있는 차량·물량을 적고 중지를 풉니다.
          </li>
          <li>그때부터 조건이 맞는 현장의 주문 가능 공장 목록에 뜹니다.</li>
        </ol>
      </Panel>
    </>
  );
}

/* ==========================================================================
 * 등록·수정 폼
 * ======================================================================== */

function PlantForm({
  plant,
  onDone,
  first,
}: {
  plant?: Plant;
  onDone: () => void;
  first?: boolean;
}) {
  const editing = plant != null;
  const { demoMode, profile } = useAuth();

  const [name, setName] = useState(plant?.name ?? '');
  const [phone, setPhone] = useState(plant?.phone ?? '');
  const [address, setAddress] = useState(plant?.address ?? '');
  const [where, setWhere] = useState<PickedLocation | null>(
    plant ? { address: plant.address, lat: plant.lat, lng: plant.lng } : null,
  );
  const [hourly, setHourly] = useState(String(plant?.hourlyRate ?? 4));
  const [prep, setPrep] = useState(String(plant?.prepMinutes ?? RULES.DEFAULT_PREP_MIN));
  const [cap, setCap] = useState<PlantCapability>(plant?.cap ?? EMPTY_CAPABILITY);

  const db = useDb();
  const [trucks, setTrucks] = useState<TruckDraft[]>(() => {
    if (!plant) return [emptyTruck()];
    const mine = db.trucks
      .filter((x) => x.plantId === plant.id)
      .sort((a, b) => a.no - b.no)
      .map((x) => ({
        id: x.id,
        plateNo: x.plateNo,
        capacityM3: x.capacityM3,
        driverName: x.driverId ? x.driver : undefined,
      }));
    return mine.length > 0 ? mine : [emptyTruck()];
  });

  const [saving, setSaving] = useState(false);
  // 같은 프레임의 두 번째 클릭을 막는다 — setState 는 다음 렌더에야 버튼을 잠근다
  const busyRef = useRef(false);

  const [error, setError] = useState<string | null>(null);

  const effectiveAddress = address || where?.address || '';
  /**
   * 보유 대수는 차량 목록의 길이다.
   * 전에는 숫자를 따로 받았는데, 실제 차량 행을 안 만들어서 "보유 12대" 인데
   * 배차 목록은 비어 있는 공장이 생겼다. 셀 곳을 하나로 두면 어긋날 수 없다.
   */
  const fleetN = trucks.length;
  const hourlyN = Number(hourly);
  const prepN = Number(prep);

  const problem =
    name.trim().length < 2
      ? '공장 이름을 두 글자 이상 적어 주세요'
      : !where
        ? '지도에서 공장 위치를 골라 주세요'
        : effectiveAddress.trim().length < 2
          ? '주소를 적어 주세요'
          : fleetN > 99
            ? '차량은 99대까지 등록할 수 있습니다'
            : !Number.isInteger(hourlyN) || hourlyN < 1 || hourlyN > 60
              ? '한 현장 시간당 출하 대수는 1~60대로 적어 주세요'
              : !Number.isInteger(prepN) || prepN < 1 || prepN > 120
                ? '상차 준비시간은 1~120분 사이 정수로 적어 주세요'
              : (validateTrucks(trucks) ?? validateCapability(cap));

  async function save() {
    if (busyRef.current || problem || !where) return;
    busyRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const data = {
        name: name.trim(),
        address: effectiveAddress.trim(),
        phone: phone.trim(),
        lat: where.lat,
        lng: where.lng,
        fleetSize: fleetN,
        hourlyRate: hourlyN,
        prepMinutes: prepN,
        cap,
      };
      const filled = fillBlankPlates(trucks);

      if (editing) {
        await updatePlantInfo(plant.id, data);
        await syncTrucks(plant.id, filled);
      } else {
        const plantId = await createPlant(data);
        // 공장을 먼저 만들어야 차량이 붙을 곳이 생긴다
        for (const tr of filled) {
          await createTruck({ plantId, plateNo: tr.plateNo, capacityM3: tr.capacityM3 });
        }
      }
      onDone();
    } catch (e) {
      setError(failure(e, editing ? '고치지 못했습니다.' : '공장을 등록하지 못했습니다.'));
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Panel
      title={editing ? `${plant.name} 고치기` : first ? '첫 공장 등록' : '새 공장 등록'}
      style={{ borderWidth: 2, borderColor: 'var(--color-rust)' }}
    >
      {first && (
        <p style={{ fontSize: '0.88rem', margin: '0 0 14px', lineHeight: 1.65 }}>
          아직 등록된 공장이 없습니다. 공장을 올리면 조건이 맞는 현장의 주문 가능 목록에 뜹니다.
        </p>
      )}
      {!demoMode && !profile?.companyId && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="bad" title="소속 회사가 없습니다">
            공장은 레미콘사에 속합니다. 로그아웃 후 다시 로그인하면서 회사를 골라 주세요.
          </Alert>
        </div>
      )}

      <label className="field">
        <span className="label">공장 이름</span>
        <input
          className="input"
          value={name}
          maxLength={60}
          placeholder="예) 가온레미콘 동탄공장"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="label">전화번호 (선택)</span>
        <input
          className="input"
          type="tel"
          value={phone}
          maxLength={20}
          placeholder="예) 031-000-1001"
          onChange={(e) => setPhone(e.target.value)}
        />
        <span style={{ fontSize: '0.76rem', color: 'var(--color-concrete-mid)' }}>
          현장이 긴급 배차를 요청할 때 이 번호로 전화합니다.
        </span>
      </label>

      <LocationPicker
        label="공장 위치"
        value={where}
        onChange={(at) => {
          setWhere(at);
          if (at.address) setAddress(at.address);
        }}
      />

      <label className="field">
        <span className="label">주소</span>
        <input
          className="input"
          value={effectiveAddress}
          maxLength={120}
          placeholder="지도에서 찍었으면 직접 적어 주세요"
          onChange={(e) => setAddress(e.target.value)}
        />
      </label>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
        }}
      >
        <label className="field">
          <span className="label">상차 준비시간 (분)</span>
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={1}
            max={120}
            value={prep}
            onChange={(e) => setPrep(e.target.value)}
          />
          <span style={{ fontSize: '0.76rem', color: 'var(--color-concrete-mid)' }}>
            주문을 받고 비비기를 시작해 차가 공장을 나서기까지. <strong>긴급주문 매칭</strong>에서
            이동시간과 더해 &lsquo;가장 빨리 오는 공장&rsquo;을 정합니다.
          </span>
        </label>
        <label className="field">
          <span className="label">한 현장 시간당 출하 (대/h)</span>
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            value={hourly}
            onChange={(e) => setHourly(e.target.value)}
          />
          <span style={{ fontSize: '0.76rem', color: 'var(--color-concrete-mid)' }}>
            약 {hourlyN > 0 ? hourlyN * TRUCK_CAPACITY_M3 : 0}m³/h. 공장은 여러 현장에 동시에
            납품하므로 보유 {fleetN}대를 한 현장에 다 쏟지 못합니다.
          </span>
        </label>
      </div>

      <TruckListEditor value={trucks} onChange={setTrucks} disabled={saving} />

      <CapabilityForm value={cap} onChange={setCap} />

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
          onClick={onDone}
          disabled={saving}
        >
          취소
        </button>
        <button
          type="button"
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={!!problem || saving}
          onClick={() => void save()}
        >
          {saving ? '저장 중…' : editing ? '저장' : '공장 등록'}
        </button>
      </div>

      {!editing && (
        <p style={{ fontSize: '0.78rem', color: 'var(--color-concrete-mid)', margin: '10px 0 0' }}>
          등록하면 <strong>출하 중지</strong> 상태로 만들어집니다. 출하 현황에서 물량을 적고
          중지를 풀어야 현장 목록에 뜹니다.
        </p>
      )}
    </Panel>
  );
}

/**
 * 차량 목록을 DB 와 맞춘다.
 *
 * 지운 줄 → 삭제, 새 줄 → 생성, 번호·적재량이 바뀐 줄 → 수정.
 * 삭제는 실패할 수 있다(운행 기록이 있거나 기사가 맡은 차). 그때는 그 차만
 * 건너뛰지 않고 오류를 올린다 — 조용히 남겨 두면 화면과 DB 가 달라진다.
 */
async function syncTrucks(plantId: string, next: TruckDraft[]) {
  const before = store.snapshot().trucks.filter((t) => t.plantId === plantId);
  const keep = new Set(next.map((t) => t.id).filter(Boolean));

  for (const old of before) {
    if (!keep.has(old.id)) await deleteTruck(old.id);
  }

  for (const tr of next) {
    if (!tr.id) {
      await createTruck({ plantId, plateNo: tr.plateNo, capacityM3: tr.capacityM3 });
      continue;
    }
    const old = before.find((x) => x.id === tr.id);
    if (old && (old.plateNo !== tr.plateNo || old.capacityM3 !== tr.capacityM3)) {
      await updateTruck(tr.id, { plateNo: tr.plateNo, capacityM3: tr.capacityM3 });
    }
  }
}
