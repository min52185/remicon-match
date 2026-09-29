'use client';

/**
 * 공장 차량 목록 편집 — 공장 등록·수정에서 쓴다.
 *
 * 전에는 등록 폼이 '보유 차량 12대' 라는 숫자만 저장했다. 실제 차량 행은 하나도
 * 안 만들어져서, 등록한 공장은 배차 화면에서 고를 차가 없었다. 주문을 받아도
 * 출하를 못 하니 등록이 반쪽이었다.
 *
 * 그래서 보유 대수를 따로 받지 않는다. 여기 적은 차량의 수가 곧 보유 대수다.
 * 숫자와 실제 차량이 어긋날 자리를 없앴다.
 *
 * 차량번호는 나중에 채울 수 있다. 새로 뽑은 차는 번호판이 늦게 나오고, 임차
 * 차량은 그날 아침에야 정해진다. 비워 두면 '미정 1' 처럼 임시로 들어가고,
 * 공장 수정 화면에서 언제든 고친다.
 */

import { TRUCK_CAPACITY_M3 } from '@/lib/rules';
import { Tag } from './ui';

export interface TruckDraft {
  /** 이미 등록된 차량이면 그 id — 새로 추가한 줄은 없다 */
  id?: string;
  plateNo: string;
  capacityM3: number;
  /** 기사가 맡고 있는 차인가 (수정 화면에서 지울 때 알려 준다) */
  driverName?: string;
}

/** [가정] 국내 차량번호 — "경기 80바 1234" 또는 "80바 1234" */
const PLATE_RE = /^(\S+\s)?\d{2,3}[가-힣]\s?\d{4}$/;

/** 고칠 것이 없으면 null */
export function validateTrucks(list: TruckDraft[]): string | null {
  if (list.length === 0) return '차량을 한 대 이상 등록하세요';

  const seen = new Set<string>();
  for (const t of list) {
    const plate = t.plateNo.trim();
    // 빈 칸은 임시 번호로 채워 넣으므로 검사하지 않는다
    if (plate && !PLATE_RE.test(plate)) {
      return `차량번호 "${plate}" 를 "경기 80바 1234" 형식으로 적어 주세요`;
    }
    if (plate && seen.has(plate)) return `차량번호 "${plate}" 가 두 번 들어갔습니다`;
    if (plate) seen.add(plate);

    if (!(t.capacityM3 > 0 && t.capacityM3 <= 12)) {
      return '적재량은 0 초과 12m³ 이하로 적어 주세요';
    }
  }
  return null;
}

/** 빈 차량번호를 '미정 N' 으로 채운다 — 저장 직전에 부른다 */
export function fillBlankPlates(list: TruckDraft[]): TruckDraft[] {
  let n = 0;
  return list.map((t) => {
    const plate = t.plateNo.trim();
    if (plate) return { ...t, plateNo: plate };
    n += 1;
    return { ...t, plateNo: `미정 ${n}` };
  });
}

export const emptyTruck = (): TruckDraft => ({ plateNo: '', capacityM3: TRUCK_CAPACITY_M3 });

export default function TruckListEditor({
  value,
  onChange,
  disabled,
}: {
  value: TruckDraft[];
  onChange: (list: TruckDraft[]) => void;
  disabled?: boolean;
}) {
  const set = (i: number, patch: Partial<TruckDraft>) =>
    onChange(value.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));

  const add = (count = 1) =>
    onChange([...value, ...Array.from({ length: count }, () => emptyTruck())]);

  const totalM3 = value.reduce((s, t) => s + (t.capacityM3 || 0), 0);

  return (
    <fieldset className="field" style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
      <legend className="label">
        보유 믹서트럭{' '}
        <span style={{ fontWeight: 400, color: 'var(--color-concrete-mid)' }}>
          — {value.length}대 · 한 번에 {Math.round(totalM3 * 10) / 10}m³
        </span>
      </legend>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {value.map((t, i) => (
          <div key={t.id ?? `new-${i}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span
              style={{
                width: 34,
                flex: 'none',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.78rem',
                color: 'var(--color-concrete-mid)',
              }}
            >
              {i + 1}호
            </span>

            <input
              className="input"
              value={t.plateNo}
              maxLength={20}
              disabled={disabled}
              placeholder="경기 80바 1234 (나중에 입력 가능)"
              aria-label={`${i + 1}호차 차량번호`}
              style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)' }}
              onChange={(e) => set(i, { plateNo: e.target.value })}
            />

            <span className="unit-input" style={{ width: 96, flex: 'none', marginTop: 0 }}>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                min={1}
                max={12}
                step={0.5}
                disabled={disabled}
                value={t.capacityM3}
                aria-label={`${i + 1}호차 적재량`}
                onChange={(e) => set(i, { capacityM3: Number(e.target.value) })}
              />
              <em>m³</em>
            </span>

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ flex: 'none', padding: '4px 8px' }}
              disabled={disabled || !!t.driverName}
              title={t.driverName ? `${t.driverName} 기사가 맡고 있어 지울 수 없습니다` : '이 줄 지우기'}
              onClick={() => remove(i)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {value.some((t) => t.driverName) && (
        <p style={{ fontSize: '0.76rem', color: 'var(--color-concrete-mid)', margin: '8px 0 0' }}>
          기사가 맡고 있는 차는 지울 수 없습니다. 기사가 <strong>차량 반납</strong>을 누르면
          지울 수 있습니다.
        </p>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={disabled}
          onClick={() => add(1)}
        >
          + 차량 추가
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={disabled}
          onClick={() => add(5)}
        >
          + 5대
        </button>
        {value.length === 0 && <Tag tone="warn">한 대 이상 필요합니다</Tag>}
      </div>

      <p style={{ fontSize: '0.76rem', color: 'var(--color-concrete-mid)', margin: '10px 0 0' }}>
        여기 적은 차량이 <strong>배차 화면의 차량 목록</strong>이 됩니다. 번호를 비워 두면
        &lsquo;미정 1&rsquo; 로 들어가고 나중에 고칠 수 있습니다.
      </p>
    </fieldset>
  );
}
