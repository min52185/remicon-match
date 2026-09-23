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
