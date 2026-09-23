'use client';

/**
 * 레미콘 사양 고르기 — KS F 4009 호칭 방법 그대로.
 * 종류를 바꾸면 그 종류에서 흔한 값으로 나머지를 맞춰 준다.
 * 표에 없는 조합이면 막지 않고 경고만 한다 (협의로 생산하는 경우가 있다).
 */

import {
  AGG_OPTIONS,
  CEMENT_TYPES,
  CONCRETE_TYPES,
  FLEX_STRENGTH_OPTIONS,
  SLUMP_OPTIONS,
  STRENGTH_OPTIONS,
  TYPE_DEFAULTS,
  isKsSpec,
  specText,
} from '@/lib/rules';
import type { ConcreteType, Spec } from '@/lib/types';
import { ChipGroup, Tag } from './ui';

export default function SpecPicker({
  spec,
  onChange,
}: {
  spec: Spec;
  onChange: (s: Spec) => void;
}) {
  const set = (patch: Partial<Spec>) => onChange({ ...spec, ...patch });

  const changeType = (type: ConcreteType) => onChange({ ...spec, type, ...TYPE_DEFAULTS[type] });

  const strengthOptions = spec.type === '포장' ? FLEX_STRENGTH_OPTIONS : STRENGTH_OPTIONS;
  const slumpSet = SLUMP_OPTIONS[spec.type];
  const slumpOptions = spec.slumpKind === 'flow' ? slumpSet.flow : slumpSet.slump;
  const ks = isKsSpec(spec);

  return (
    <div>
      <ChipGroup label="종류" options={CONCRETE_TYPES} value={spec.type} onChange={changeType} />

      <ChipGroup
        label="굵은골재 최대치수"
        options={AGG_OPTIONS}
        value={spec.aggMm}
        onChange={(aggMm) => set({ aggMm })}
        format={(v) => `${v}mm`}
      />

      <ChipGroup
        label={spec.type === '포장' ? '휨강도' : '호칭강도'}
        options={strengthOptions}
        value={spec.strength}
        onChange={(strength) => set({ strength })}
        format={(v) => `${v}MPa`}
      />

      {slumpSet.flow.length > 0 && (
        <ChipGroup
          label="슬럼프 방식"
          options={['slump', 'flow'] as const}
          value={spec.slumpKind}
          onChange={(kind) =>
            set({
              slumpKind: kind,
              slumpMm: (kind === 'flow' ? slumpSet.flow : slumpSet.slump)[0] ?? spec.slumpMm,
            })
          }
          format={(v) => (v === 'flow' ? '슬럼프 플로' : '슬럼프')}
        />
      )}

      <ChipGroup
        label={spec.slumpKind === 'flow' ? '슬럼프 플로' : '슬럼프'}
        options={slumpOptions}
        value={spec.slumpMm}
        onChange={(slumpMm) => set({ slumpMm })}
        format={(v) => `${v}mm`}
      />

      <label className="field">
        <span className="label">시멘트</span>
        <select
          className="select"
          value={spec.cement}
          onChange={(e) => set({ cement: e.target.value })}
        >
          {CEMENT_TYPES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          background: 'var(--color-paper)',
          border: '1px solid var(--color-line)',
          borderRadius: 'var(--radius-sharp)',
        }}
      >
        <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem' }}>
          {specText(spec)}
        </strong>
        <span style={{ marginLeft: 'auto' }}>
          {ks ? (
            <Tag tone="ok">KS F 4009 표 안</Tag>
          ) : (
            <Tag tone="warn">표에 없는 조합 — 공장 협의 필요</Tag>
          )}
        </span>
      </div>
    </div>
  );
}
