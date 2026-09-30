'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { simClock, SPEED_OPTIONS } from '@/lib/services/clock';
import { clock, duration } from '@/lib/format';
import { useMounted, useNow } from '@/lib/store/hooks';
import s from './AppShell.module.css';

export interface TabDef {
  href: string;
  label: string;
  icon: ReactNode;
  /** 숫자를 넣으면 배지가 붙는다 (새 주문 알림 등) */
  badge?: number;
  /**
   * 하위 경로까지 활성으로 볼지. '/site' 처럼 다른 탭의 앞부분이 되는 주소는
   * exact 를 켜야 한다 — 안 그러면 '/site/order' 에서 두 탭이 같이 켜진다.
   */
  exact?: boolean;
  /** 배지를 긴급 색으로 — 보통 알림과 구분한다 */
  urgent?: boolean;
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
          const active = t.exact
            ? pathname === t.href
            : pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`${s.tab} ${active ? s.tabActive : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                {t.icon}
                {!!t.badge && (
                  <span className={s.badge + (t.urgent ? ' ' + s.badgeUrgent : '')}>
                    {t.badge > 9 ? '9+' : t.badge}
                  </span>
                )}
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
 *
 * 시계는 Supabase 에 한 줄로 두고 Realtime 으로 공유한다 — 어느 기기에서 눌러도
 * 현장·공장·기사 화면이 같이 움직인다. 전에는 브라우저 저장소에만 있어서 기기마다
 * 따로 갔고, 한쪽만 배속을 올리면 시각이 몇 시간씩 벌어졌다.
 */
function ClockBar() {
  const now = useNow(500);
  const mounted = useMounted();
  const speed = mounted ? simClock.speed : 1;

  // 시연 시각이 실제와 얼마나 벌어졌는지. 배속을 올린 채 두면 금방 커진다.
  const drift = mounted ? simClock.driftMinutes() : 0;
  const off = Math.abs(drift) >= 1;

  return (
    <div className={`${s.clockBar} no-print`}>
      <span className={s.clockNow}>{mounted ? clock(now) : '--:--'}</span>

      {off ? (
        <button
          type="button"
          className={s.nowBtn}
          onClick={() => simClock.reset()}
          title="모든 기기의 시계를 지금 시각으로, 배속을 ×1 로 되돌립니다"
        >
          실제보다 {drift > 0 ? `${duration(drift)} 빠름` : `${duration(-drift)} 느림`} · 지금
          시각으로
        </button>
      ) : (
        <span>시연 배속</span>
      )}

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
