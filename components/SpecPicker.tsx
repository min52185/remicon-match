'use client';

/**
 * 레미콘 사양 고르기 — KS F 4009 호칭 방법 그대로.
 *
 * 고정 목록만 누르게 하지 않는다. 고강도 45MPa, 골재 15mm 처럼 표에 없는 값도
 * 협의로 생산하는 일이 실제로 있어서, 칸마다 **직접입력**을 열어 둔다.
 * 표 밖이라고 막지는 않고 "표에 없는 조합"이라고만 알려 준다 — 막으면 쓸 수 없는
 * 화면이 되고, 아무 말도 안 하면 실수를 못 잡는다.
 *
 * 범위 검사는 lib/rules.ts 의 validateSpec() 이 맡는다. 값이 잘못된 동안에는
 * onChange 를 부르지 않고 onInvalid 로 알려, 부모가 제출 버튼을 잠글 수 있게 한다.
 */

import { useEffect, useState } from 'react';
import {
  AGG_OPTIONS,
  CEMENT_TYPES,
  CONCRETE_TYPES,
  FLEX_STRENGTH_OPTIONS,
  SLUMP_OPTIONS,
  SPEC_LIMITS,
  STRENGTH_OPTIONS,
  TYPE_DEFAULTS,
  isKsSpec,
  specCode,
  specText,
  validateSpec,
} from '@/lib/rules';
import type { ConcreteType, SlumpKind, Spec } from '@/lib/types';
import { Tag } from './ui';

const CUSTOM = 'custom';

export default function SpecPicker({
  spec,
  onChange,
  onInvalid,
}: {
  spec: Spec;
  /** 값이 올바를 때만 불린다 */
  onChange: (s: Spec) => void;
  /** 직접입력이 잘못된 동안의 안내 문구. 괜찮아지면 null. */
  onInvalid?: (message: string | null) => void;
}) {
  const set = (patch: Partial<Spec>) => onChange({ ...spec, ...patch });
  const changeType = (type: ConcreteType) => onChange({ ...spec, type, ...TYPE_DEFAULTS[type] });

  /** 직접입력 칸이 비어 있거나 범위를 벗어난 동안의 문구 */
  const [draftError, setDraftError] = useState<string | null>(null);

  const error = draftError ?? validateSpec(spec);
  useEffect(() => onInvalid?.(error), [error, onInvalid]);

  const strengthOptions: [number, string][] =
    spec.type === '포장'
      ? [
          ...FLEX_STRENGTH_OPTIONS.map((v) => [v, `휨 ${v.toFixed(1)}MPa`] as [number, string]),
          ...STRENGTH_OPTIONS.map((v) => [v, `${v}MPa`] as [number, string]),
        ]
      : STRENGTH_OPTIONS.map((v) => [v, `${v}MPa`] as [number, string]);

  const slumpSet = SLUMP_OPTIONS[spec.type];

  return (
    <div>
      {/* 종류 — 바꾸면 그 종류에서 흔한 값으로 나머지를 맞춰 준다 */}
      <div className="field">
        <span className="label">콘크리트 종류</span>
        <div className="chips" role="radiogroup" aria-label="콘크리트 종류">
          {CONCRETE_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className="chip"
              aria-pressed={t === spec.type}
              onClick={() => changeType(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="spec-grid">
        <NumField
          // 종류를 바꾸면 직접입력 상태도 처음으로 되돌린다
          key={`agg-${spec.type}`}
          label="굵은골재 최대치수"
          options={AGG_OPTIONS.map((v) => [v, `${v}mm`])}
          value={spec.aggMm}
          unit="mm"
          placeholder="예) 15"
          min={SPEC_LIMITS.AGG_MIN_MM}
          max={SPEC_LIMITS.AGG_MAX_MM}
          step={1}
          onValue={(aggMm) => set({ aggMm })}
          onDraftError={setDraftError}
        />

        <NumField
          key={`str-${spec.type}`}
          label={spec.type === '포장' ? '휨강도' : '호칭강도'}
          hint={spec.type === '포장' ? '포장은 휨강도' : undefined}
          options={strengthOptions}
          value={spec.strength}
          unit="MPa"
          placeholder="예) 45"
          min={SPEC_LIMITS.STRENGTH_MIN_MPA}
          max={SPEC_LIMITS.STRENGTH_MAX_MPA}
          step={0.5}
          onValue={(strength) => set({ strength })}
          onDraftError={setDraftError}
        />

        <SlumpField
          key={`sl-${spec.type}`}
          spec={spec}
          slumpSet={slumpSet}
          onValue={(slumpKind, slumpMm) => set({ slumpKind, slumpMm })}
          onDraftError={setDraftError}
        />

        <label className="field span-2">
          <span className="label">시멘트 종류</span>
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
      </div>

      {/* 판정 한 줄 — 잘못된 값 > 표 밖 조합 > 표준 조합 순으로 알린다 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          padding: '10px 12px',
          background: 'var(--color-paper)',
          border: '1px solid',
          borderColor: error ? 'var(--color-bad)' : 'var(--color-line)',
          borderRadius: 'var(--radius-sharp)',
        }}
        aria-live="polite"
      >
        {error ? (
          <span style={{ fontSize: '0.86rem', color: 'var(--color-bad)' }}>{error}</span>
        ) : (
          <>
            <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem' }}>
              {specText(spec)}
            </strong>
            <span style={{ marginLeft: 'auto' }}>
              {isKsSpec(spec) ? (
                <Tag tone="ok">KS F 4009 표준 조합</Tag>
              ) : (
                <Tag tone="warn">표에 없는 조합 ({specCode(spec)}) — 공장 협의 필요</Tag>
              )}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/* ==========================================================================
 * 목록 + 직접입력 한 칸
 * ======================================================================== */

function NumField({
  label,
  hint,
  options,
  value,
  unit,
  placeholder,
  min,
  max,
  step,
  onValue,
  onDraftError,
}: {
  label: string;
  hint?: string;
  options: [number, string][];
  value: number;
  unit: string;
  placeholder: string;
  min: number;
  max: number;
  step: number;
  onValue: (v: number) => void;
  onDraftError: (m: string | null) => void;
}) {
  // 지금 값이 목록에 없으면 처음부터 직접입력 상태로 연다 (즐겨찾기에서 불러온 경우)
  const [custom, setCustom] = useState(() => !options.some(([v]) => v === value));
  const [text, setText] = useState(() => String(value));

  return (
    <div className="field">
      <span className="label">
        {label}
        {hint && (
          <small style={{ fontWeight: 400, color: 'var(--color-concrete-mid)' }}> · {hint}</small>
        )}
      </span>

      <select
        className="select"
        value={custom ? CUSTOM : String(value)}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
            setText(String(value));
            return;
          }
          setCustom(false);
          onDraftError(null);
          onValue(Number(e.target.value));
        }}
      >
        {options.map(([v, l]) => (
          <option key={v} value={String(v)}>
            {l}
          </option>
        ))}
        <option value={CUSTOM}>직접입력</option>
      </select>

      {custom && (
        <span className="unit-input">
          <input
            className="input"
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            value={text}
            placeholder={placeholder}
            aria-label={`${label} 직접입력`}
            onChange={(e) => {
              const raw = e.target.value;
              setText(raw);
              if (raw === '') {
                onDraftError(`${label}를 입력하세요`);
                return;
              }
              const n = Number(raw);
              if (!Number.isFinite(n)) {
                onDraftError(`${label}는 숫자로 입력하세요`);
                return;
              }
              // 범위 판정은 validateSpec() 이 맡는다 — 값을 올려보내고 문구는 거기서 나온다
              onDraftError(null);
              onValue(n);
            }}
          />
          <em>{unit}</em>
        </span>
      )}
    </div>
  );
}

/* ==========================================================================
 * 슬럼프 — 슬럼프와 슬럼프 플로를 한 칸에서 고른다
 *
 * 둘은 같은 것을 다른 방법으로 잰 값이라 한 칸에 두는 편이 헷갈리지 않는다.
 * 직접입력일 때만 구분을 따로 고르게 한다.
 * ======================================================================== */

function SlumpField({
  spec,
  slumpSet,
  onValue,
  onDraftError,
}: {
  spec: Spec;
  slumpSet: { slump: number[]; flow: number[] };
  onValue: (kind: SlumpKind, mm: number) => void;
  onDraftError: (m: string | null) => void;
}) {
  const key = (k: SlumpKind, v: number) => `${k === 'flow' ? 'f' : 's'}:${v}`;
  const current = key(spec.slumpKind, spec.slumpMm);
  const listed = [
    ...slumpSet.slump.map((v) => key('slump', v)),
    ...slumpSet.flow.map((v) => key('flow', v)),
  ];

  const [custom, setCustom] = useState(() => !listed.includes(current));
  const [text, setText] = useState(() => String(spec.slumpMm));

  const isFlow = spec.slumpKind === 'flow';
  const limits = isFlow
    ? { min: SPEC_LIMITS.FLOW_MIN_MM, max: SPEC_LIMITS.FLOW_MAX_MM }
    : { min: SPEC_LIMITS.SLUMP_MIN_MM, max: SPEC_LIMITS.SLUMP_MAX_MM };

  return (
    <div className="field span-2">
      <span className="label">슬럼프 또는 슬럼프 플로</span>

      <select
        className="select"
        value={custom ? CUSTOM : current}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
            setText(String(spec.slumpMm));
            return;
          }
          setCustom(false);
          onDraftError(null);
          const [k, v] = e.target.value.split(':');
          onValue(k === 'f' ? 'flow' : 'slump', Number(v));
        }}
      >
        <optgroup label="슬럼프">
          {slumpSet.slump.map((v) => (
            <option key={`s${v}`} value={key('slump', v)}>
              슬럼프 {v}mm
            </option>
          ))}
        </optgroup>
        {slumpSet.flow.length > 0 && (
          <optgroup label="슬럼프 플로">
            {slumpSet.flow.map((v) => (
              <option key={`f${v}`} value={key('flow', v)}>
                슬럼프 플로 {v}mm
              </option>
            ))}
          </optgroup>
        )}
        <option value={CUSTOM}>직접입력</option>
      </select>

      {custom && (
        <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <select
            className="select"
            style={{ flex: '1 1 130px', minWidth: 130 }}
            value={spec.slumpKind}
            aria-label="슬럼프 구분"
            onChange={(e) => {
              const kind = e.target.value as SlumpKind;
              const n = Number(text);
              onDraftError(null);
              onValue(kind, Number.isFinite(n) ? n : spec.slumpMm);
            }}
          >
            <option value="slump">슬럼프</option>
            <option value="flow">슬럼프 플로</option>
          </select>
          <span className="unit-input" style={{ flex: '1 1 120px' }}>
            <input
              className="input"
              type="number"
              inputMode="numeric"
              min={limits.min}
              max={limits.max}
              step={5}
              value={text}
              placeholder={isFlow ? '예) 650' : '예) 100'}
              aria-label="슬럼프 값 직접입력"
              onChange={(e) => {
                const raw = e.target.value;
                setText(raw);
                if (raw === '') {
                  onDraftError('슬럼프 값을 입력하세요');
                  return;
                }
                const n = Number(raw);
                if (!Number.isFinite(n)) {
                  onDraftError('슬럼프는 숫자로 입력하세요');
                  return;
                }
                onDraftError(null);
                onValue(spec.slumpKind, n);
              }}
            />
            <em>mm</em>
          </span>
        </div>
      )}
    </div>
  );
}
