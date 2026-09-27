'use client';

/**
 * 공장 생산 능력 입력 — 등록과 수정에서 같이 쓴다.
 *
 * 이 값이 현장의 "주문 가능 공장" 목록을 정한다. 현장이 27MPa 를 주문하면
 * 최대 호칭강도가 24MPa 인 공장은 목록에서 빠진다. 그래서 공장이 직접, 정확히
 * 적을 수 있어야 한다 — 시연용 고정값으로 두면 실제로는 못 쓰는 기능이다.
 *
 * 종류마다 최대 호칭강도를 따로 받는 이유: 한 공장이 보통 35MPa 는 만들어도
 * 고강도 60MPa 는 못 만드는 것이 보통이다. 하나로 뭉치면 판정이 틀린다.
 */

import {
  AGG_OPTIONS,
  CEMENT_TYPES,
  CONCRETE_TYPES,
  SPEC_LIMITS,
  cementShort,
} from '@/lib/rules';
import type { ConcreteType, PlantCapability } from '@/lib/types';

/** [가정] 종류별로 처음 보여 줄 최대 호칭강도 */
const DEFAULT_MAX: Partial<Record<ConcreteType, number>> = {
  보통: 30,
  경량: 30,
  포장: 4.5,
  고강도: 50,
};

/** 공장이 실제로 쓰는 골재 치수 — 사양 쪽 AGG_OPTIONS 에 15mm 를 더한다 */
const PLANT_AGGS = [15, ...AGG_OPTIONS];

/** 고칠 것이 없으면 null. 화면에 그대로 띄울 한 줄이다. */
export function validateCapability(cap: PlantCapability): string | null {
  const types = Object.keys(cap.maxStrength) as ConcreteType[];
  if (types.length === 0) return '생산 가능한 콘크리트 종류를 하나 이상 고르세요';

  for (const t of types) {
    const v = cap.maxStrength[t];
    if (!(v != null && v > SPEC_LIMITS.STRENGTH_MIN_MPA && v <= SPEC_LIMITS.STRENGTH_MAX_MPA)) {
      return `${t} 최대 호칭강도를 0 초과 ${SPEC_LIMITS.STRENGTH_MAX_MPA}MPa 이하로 적으세요`;
    }
  }
  if (cap.aggs.length === 0) return '굵은골재 최대치수를 하나 이상 고르세요';
  if (cap.cements.length === 0) return '보유 시멘트를 하나 이상 고르세요';
  return null;
}

export const EMPTY_CAPABILITY: PlantCapability = {
  maxStrength: {},
  aggs: [],
  flow: false,
  cements: [],
};

export default function CapabilityForm({
  value,
  onChange,
}: {
  value: PlantCapability;
  onChange: (cap: PlantCapability) => void;
}) {
  const toggleType = (t: ConcreteType, on: boolean) => {
    const next = { ...value.maxStrength };
    if (on) next[t] = next[t] ?? DEFAULT_MAX[t] ?? 30;
    else delete next[t];
    onChange({ ...value, maxStrength: next });
  };

  const setMax = (t: ConcreteType, raw: string) => {
    const n = Number(raw);
    onChange({
      ...value,
      maxStrength: { ...value.maxStrength, [t]: raw === '' ? NaN : Math.round(n * 10) / 10 },
    });
  };

  const toggleIn = <T,>(list: T[], v: T, on: boolean) =>
    on ? [...list, v] : list.filter((x) => x !== v);

  return (
    <>
      <fieldset className="field" style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
        <legend className="label">생산 가능 콘크리트 · 최대 호칭강도</legend>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {CONCRETE_TYPES.map((t) => {
            const on = value.maxStrength[t] != null;
            const raw = value.maxStrength[t];
            return (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: '0.9rem',
                    minWidth: 92,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => toggleType(t, e.target.checked)}
                    style={{ width: 18, height: 18 }}
                  />
                  {t}
                </label>
                <span className="unit-input" style={{ flex: 1, marginTop: 0, opacity: on ? 1 : 0.4 }}>
                  <input
                    className="input"
                    type="number"
                    inputMode="decimal"
                    step={0.5}
                    min={0}
                    max={SPEC_LIMITS.STRENGTH_MAX_MPA}
                    disabled={!on}
                    value={on ? (Number.isFinite(raw) ? String(raw) : '') : ''}
                    aria-label={`${t} 최대 호칭강도`}
                    onChange={(e) => setMax(t, e.target.value)}
                  />
                  <em>MPa</em>
                </span>
              </div>
            );
          })}
        </div>
        <p style={{ fontSize: '0.76rem', color: 'var(--color-concrete-mid)', margin: '8px 0 0' }}>
          포장 콘크리트는 휨강도입니다 (보통 4.0 또는 4.5MPa).
        </p>
      </fieldset>

      <fieldset className="field" style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
        <legend className="label">굵은골재 최대치수</legend>
        <div className="chips">
          {PLANT_AGGS.map((v) => (
            <button
              key={v}
              type="button"
              className="chip"
              aria-pressed={value.aggs.includes(v)}
              onClick={() =>
                onChange({ ...value, aggs: toggleIn(value.aggs, v, !value.aggs.includes(v)) })
              }
            >
              {v}mm
            </button>
          ))}
        </div>
      </fieldset>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '4px 0 14px',
          fontSize: '0.9rem',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={value.flow}
          onChange={(e) => onChange({ ...value, flow: e.target.checked })}
          style={{ width: 18, height: 18 }}
        />
        슬럼프 플로(고유동) 콘크리트를 만들 수 있습니다
      </label>

      <fieldset className="field" style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
        <legend className="label">보유 시멘트</legend>
        <div className="chips">
          {CEMENT_TYPES.map((c) => (
            <button
              key={c}
              type="button"
              className="chip"
              aria-pressed={value.cements.includes(c)}
              onClick={() =>
                onChange({
                  ...value,
                  cements: toggleIn(value.cements, c, !value.cements.includes(c)),
                })
              }
            >
              {cementShort(c)}
            </button>
          ))}
        </div>
        <p style={{ fontSize: '0.76rem', color: 'var(--color-concrete-mid)', margin: '8px 0 0' }}>
          여기 없는 시멘트를 요구하는 주문은 이 공장에 뜨지 않습니다.
        </p>
      </fieldset>
    </>
  );
}
