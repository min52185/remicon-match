'use client';

/**
 * 레미콘사 — 출하 현황 입력.
 *
 * 현장이 보는 "주문 가능 공장" 목록은 이 화면의 값으로 결정된다.
 * 공장이 수시로 고칠 수 있어야 하므로 입력은 최대한 짧게 둔다.
 */

import { PlantShell } from '@/components/RoleShells';
import { Empty, MockNotice, Panel, Row, Tag } from '@/components/ui';
import { clock, m3 } from '@/lib/format';
import { DeliveryRules, PHASE_LABEL, PHASE_TONE, cementShort } from '@/lib/rules';
import { activeDeliveriesOfPlant, updatePlantStatus } from '@/lib/store';
import { useDb, useMounted, useNow } from '@/lib/store/hooks';
import type { Plant } from '@/lib/types';

export default function PlantStatusPage() {
  return (
    <PlantShell
      title="출하 현황"
      description="지금 내보낼 수 있는 차량과 물량을 알려 주면, 현장 화면에 바로 반영됩니다."
    >
      {(plant) => <StatusBody plant={plant} />}
    </PlantShell>
  );
}

function StatusBody({ plant }: { plant: Plant }) {
  const db = useDb();
  const now = useNow(2000);
  const mounted = useMounted();
  const active = activeDeliveriesOfPlant(db, plant.id);

  if (!mounted) return <Empty>불러오는 중…</Empty>;

  return (
    <>
      <MockNotice />

      <Panel
        title="지금 출하 가능"
        aside={
          plant.isOpen ? <Tag tone="ok">출하 중</Tag> : <Tag tone="bad">출하 중지</Tag>
        }
        style={{ borderWidth: 2, borderColor: plant.isOpen ? undefined : 'var(--color-bad)' }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 12,
          }}
        >
          <label className="field">
            <span className="label">출하 가능 차량 (대)</span>
            <input
              type="number"
              className="input"
              min={0}
              max={plant.fleetSize}
              value={plant.availableTrucks}
              onChange={(e) =>
                updatePlantStatus(plant.id, {
                  availableTrucks: Math.max(0, Math.min(plant.fleetSize, Number(e.target.value) || 0)),
                })
              }
            />
          </label>
          <label className="field">
            <span className="label">출하 가능 물량 (m³)</span>
            <input
              type="number"
              className="input"
              min={0}
              step={6}
              value={plant.availableVolume}
              onChange={(e) =>
                updatePlantStatus(plant.id, {
                  availableVolume: Math.max(0, Number(e.target.value) || 0),
                })
              }
            />
          </label>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 0',
            fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={!plant.isOpen}
            onChange={(e) => updatePlantStatus(plant.id, { isOpen: !e.target.checked })}
            style={{ width: 18, height: 18 }}
          />
          출하 중지 (점검·원자재 부족 등)
        </label>

        <Row label="보유 차량">{plant.fleetSize}대</Row>
        <Row label="시간당 출하 능력">
          {plant.hourlyRate}대/h{' '}
          <span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--color-concrete-mid)' }}>
            한 현장 기준 [가정]
          </span>
        </Row>
        <Row label="운행 중">{active.length}대</Row>
      </Panel>

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

      <Panel title={`운행 중인 차량 ${active.length}대`}>
        {active.length === 0 ? (
          <Empty>운행 중인 차량이 없습니다.</Empty>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>호차</th>
                  <th>현장</th>
                  <th className="num">물량</th>
                  <th>상태</th>
                  <th>도착 예상</th>
                </tr>
              </thead>
              <tbody>
                {active.map((d) => {
                  const truck = db.trucks.find((t) => t.id === d.truckId);
                  const site = db.sites.find((s) => s.id === d.siteId);
                  const phase = DeliveryRules.phase(d, now);
                  return (
                    <tr key={d.id}>
                      <td>{truck?.no}</td>
                      <td style={{ fontSize: '0.8rem' }}>{site?.name}</td>
                      <td className="num">{d.volumeM3}</td>
                      <td>
                        <Tag tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Tag>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{clock(d.etaCurrentAt)}</td>
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
    </>
  );
}
