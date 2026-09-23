'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { simClock, SPEED_OPTIONS } from '@/lib/services/clock';
import { clock } from '@/lib/format';
import { useMounted, useNow } from '@/lib/store/hooks';
import s from './AppShell.module.css';

export interface TabDef {
  href: string;
  label: string;
  icon: ReactNode;
  /** 숫자를 넣으면 배지가 붙는다 (새 주문 알림 등) */
  badge?: number;
}

interface Props {
  roleLabel: string;
  tabs: TabDef[];
  /** 상단 우측 — 현장/공장 고르기 같은 것 */
  picker?: ReactNode;
  title: string;
  description?: string;
  /** 시연 배속 막대를 띄울지 */
  showClock?: boolean;
  children: ReactNode;
}

export default function AppShell({
  roleLabel,
  tabs,
  picker,
  title,
  description,
  showClock = true,
  children,
}: Props) {
  const pathname = usePathname();

  return (
    <div className={s.shell}>
      <header className={`${s.top} no-print`}>
        <div className={`wrap ${s.topInner}`}>
          <Link href="/" className={s.logo}>
            레미<span className={s.logoDot}>go</span>
          </Link>
          <span className={s.roleBadge}>{roleLabel}</span>
          <div className={s.spacer} />
          {picker}
        </div>
      </header>

      <main className={s.main}>
        <div className="wrap">
          <div className={s.pageHead}>
            <h1>{title}</h1>
            {description && <p>{description}</p>}
          </div>
          {showClock && <ClockBar />}
          {children}
        </div>
      </main>

      <nav className={`${s.tabs} no-print`} aria-label="화면 이동">
        {tabs.map((t) => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`${s.tab} ${active ? s.tabActive : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                {t.icon}
                {!!t.badge && <span className={s.badge}>{t.badge > 9 ? '9+' : t.badge}</span>}
              </span>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * 시연 배속. 실제 서비스에서는 1배속 고정이지만, 5시간짜리 타설을 발표 자리에서
 * 몇 분 만에 보여 주려면 시계를 빠르게 돌릴 수 있어야 한다.
 * 탭 간 공유라 현장·공장·기사 화면의 시계가 같이 움직인다.
 */
function ClockBar() {
  const now = useNow(500);
  const mounted = useMounted();
  const speed = mounted ? simClock.speed : 1;

  return (
    <div className={`${s.clockBar} no-print`}>
      <span className={s.clockNow}>{mounted ? clock(now) : '--:--'}</span>
      <span>시연 배속</span>
      <div className={s.speeds}>
        {SPEED_OPTIONS.map((v) => (
          <button
            key={v}
            type="button"
            className={`${s.speed} ${speed === v ? s.speedOn : ''}`}
            onClick={() => simClock.setSpeed(v)}
          >
            ×{v}
          </button>
        ))}
      </div>
    </div>
  );
}
