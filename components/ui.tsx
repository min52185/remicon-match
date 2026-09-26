'use client';

import type { ReactNode } from 'react';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'accent' | 'muted';

export function Tag({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

/** 제목 + 내용 카드 */
export function Panel({
  title,
  aside,
  children,
  style,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section className="card card-pad" style={{ marginBottom: 16, ...style }}>
      {(title || aside) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 12,
          }}
        >
          {title && <h2 style={{ fontSize: '1rem', flex: 1 }}>{title}</h2>}
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

/** 라벨 + 값 한 줄 */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        padding: '6px 0',
        borderBottom: '1px solid var(--color-line)',
        fontSize: '0.88rem',
      }}
    >
      <span style={{ color: 'var(--color-concrete-mid)', minWidth: 96, flex: 'none' }}>{label}</span>
      <span style={{ flex: 1, textAlign: 'right', fontWeight: 500 }}>{children}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        color: 'var(--color-concrete-mid)',
        fontSize: '0.88rem',
        textAlign: 'center',
        padding: '28px 12px',
        margin: 0,
      }}
    >
      {children}
    </p>
  );
}

export function ChipGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
  format,
  disabledOf,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
  disabledOf?: (v: T) => boolean;
}) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="chips">
        {options.map((o) => (
          <button
            key={String(o)}
            type="button"
            className="chip"
            aria-pressed={o === value}
            disabled={disabledOf?.(o)}
            onClick={() => onChange(o)}
          >
            {format ? format(o) : String(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 가상 데이터임을 화면에 남긴다 (지시서 11장) */
export function MockNotice({ children }: { children?: ReactNode }) {
  return (
    <p className="mock-notice" style={{ marginBottom: 16 }}>
      {children ??
        '시연용 가상 데이터입니다. 공장·현장·차량은 실제 업체와 무관합니다. 데이터는 이 브라우저에만 저장됩니다.'}
    </p>
  );
}

/* ==========================================================================
 * 대시보드 조각
 *
 * 현장·공장 현황판이 같은 모양을 써야 해서 여기에 둔다.
 * 숫자를 크게, 단위를 작게 — 현장에서 장갑 낀 채 흘깃 보는 화면이다.
 * ======================================================================== */

const TONE_COLOR: Record<Tone, string | undefined> = {
  ok: 'var(--color-ok)',
  warn: 'var(--color-warn)',
  bad: 'var(--color-bad)',
  info: 'var(--color-info)',
  accent: 'var(--color-rust)',
  muted: undefined,
};

/** 지표 타일 한 칸 */
export function Stat({
  label,
  value,
  unit,
  tone = 'muted',
  hint,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: Tone;
  hint?: ReactNode;
}) {
  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'var(--color-paper)',
        border: '1px solid var(--color-line)',
        borderRadius: 'var(--radius-sharp)',
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: '0.72rem',
          color: 'var(--color-concrete-mid)',
          marginBottom: 4,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.35rem',
          lineHeight: 1.1,
          fontWeight: 600,
          color: TONE_COLOR[tone] ?? 'var(--color-concrete-dark)',
          wordBreak: 'keep-all',
        }}
      >
        {value}
        {unit && (
          <span style={{ fontSize: '0.78rem', fontWeight: 400, marginLeft: 2 }}>{unit}</span>
        )}
      </div>
      {hint && (
        <div style={{ fontSize: '0.72rem', color: 'var(--color-concrete-mid)', marginTop: 3 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

/** 지표 타일을 폭에 맞춰 늘어놓는다 */
export function StatGrid({ children, min = 108 }: { children: ReactNode; min?: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
        gap: 8,
      }}
    >
      {children}
    </div>
  );
}

/** 진행률 막대 */
export function Bar({
  done,
  total,
  tone = 'accent',
  height = 6,
}: {
  done: number;
  total: number;
  tone?: Tone;
  height?: number;
}) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (done / total) * 100)) : 0;
  return (
    <div
      style={{
        height,
        background: 'var(--color-paper)',
        border: '1px solid var(--color-line)',
        borderRadius: 3,
        overflow: 'hidden',
      }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          background: TONE_COLOR[tone] ?? 'var(--color-rust)',
          transition: 'width .4s',
        }}
      />
    </div>
  );
}

/** 눈에 띄어야 하는 알림 한 줄 */
export function Alert({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title: ReactNode;
  children?: ReactNode;
}) {
  const color = TONE_COLOR[tone] ?? 'var(--color-concrete-wet)';
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        padding: '10px 12px',
        background: 'var(--color-paper)',
        borderLeft: `3px solid ${color}`,
        borderRadius: 'var(--radius-sharp)',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <strong style={{ fontSize: '0.88rem', display: 'block', color }}>{title}</strong>
        {children && (
          <span style={{ fontSize: '0.82rem', color: 'var(--color-concrete-wet)', lineHeight: 1.5 }}>
            {children}
          </span>
        )}
      </div>
    </div>
  );
}
