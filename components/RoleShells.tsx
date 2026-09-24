'use client';

/**
 * 역할별 화면 껍데기. 상단 바·하단 탭·현장(공장) 고르기를 한 군데서 맡는다.
 *
 * children 을 함수로 받는 이유: 위에서 고른 현장/공장 id 를 아래 화면이 그대로 써야 하는데,
 * 껍데기가 children 을 감싸는 구조라 context 로는 페이지가 읽을 수 없기 때문이다.
 *
 * 로그인 상태에서는 **내 회사 것만** 고를 수 있게 거른다. DB 의 RLS 가 이미 쓰기를 막지만,
 * 고를 수조차 없게 하는 편이 낫다 — 눌러 보고 나서 권한 오류를 보는 것은 좋은 화면이 아니다.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import AppShell from './AppShell';
import {
  IconDoc,
  IconFactory,
  IconInbox,
  IconOrder,
  IconPin,
  IconSend,
  IconSliders,
  IconStar,
  IconTruck,
} from './icons';
import { Empty, Panel } from './ui';
import { useAuth } from '@/lib/auth';
import { HOME_BY_ROLE, ROLE_LABEL } from '@/lib/routes';
import { useDb, useSelection } from '@/lib/store/hooks';
import type { Plant, Role, Site } from '@/lib/types';
import s from './AppShell.module.css';

interface ShellProps<T> {
  title: string;
  description?: string;
  showClock?: boolean;
  children: (selected: T) => ReactNode;
}

/* ==========================================================================
 * 로그인·역할 확인
 * ======================================================================== */

/**
 * 로그인하지 않았거나 역할이 다르면 화면을 열지 않는다.
 * Supabase 키가 없는 시연 모드에서는 이 검사를 건너뛴다.
 */
function useGate(required: Role) {
  const { demoMode, loading, profile, needsCompany } = useAuth();
  const router = useRouter();

  const blocked = !demoMode && !loading && (!profile || needsCompany);

  useEffect(() => {
    if (blocked) router.replace('/login');
  }, [blocked, router]);

  return {
    demoMode,
    profile,
    /** 아직 판단할 수 없음 */
    pending: !demoMode && (loading || blocked),
    wrongRole: !demoMode && !!profile && !needsCompany && profile.role !== required,
  };
}

function WrongRole({ required, actual }: { required: Role; actual: Role }) {
  return (
    <main className="wrap" style={{ paddingBlock: 40, maxWidth: 520 }}>
      <Panel title="이 화면은 열 수 없습니다">
        <p style={{ fontSize: '0.9rem', margin: '0 0 14px', lineHeight: 1.6 }}>
          여기는 <strong>{ROLE_LABEL[required]}</strong> 화면입니다. 지금 로그인한 계정은{' '}
          <strong>{ROLE_LABEL[actual]}</strong> 입니다.
        </p>
        <Link href={HOME_BY_ROLE[actual]} className="btn btn-primary btn-block">
          {ROLE_LABEL[actual]} 화면으로 가기
        </Link>
      </Panel>
    </main>
  );
}

/** 상단 오른쪽 — 누구로 로그인했는지와 로그아웃 */
function AccountChip() {
  const { demoMode, profile, signOut } = useAuth();
  if (demoMode || !profile) return null;
  return (
    <button
      type="button"
      className={s.roleBadge}
      title="로그아웃"
      style={{ cursor: 'pointer' }}
      onClick={() => void signOut()}
    >
      {profile.name} · 로그아웃
    </button>
  );
}

/* ==========================================================================
 * 현장
 * ======================================================================== */

export function SiteShell({ title, description, showClock, children }: ShellProps<Site>) {
  const db = useDb();
  const { demoMode, profile, pending, wrongRole } = useGate('site');

  // 내 회사의 현장만
  const mine = demoMode
    ? db.sites
    : db.sites.filter((x) => !x.companyId || x.companyId === profile?.companyId);

  const [siteId, setSiteId] = useSelection('site', mine[0]?.id ?? '');
  const site = mine.find((x) => x.id === siteId) ?? mine[0];

  const pendingOrders = db.orders.filter(
    (o) => o.siteId === site?.id && (o.status === 'requested' || o.status === 'accepted'),
  ).length;

  const tabs = [
    { href: '/site/order', label: '주문', icon: <IconOrder /> },
    { href: '/site/favorites', label: '즐겨찾기', icon: <IconStar /> },
    { href: '/site/allocate', label: 'AI 배분', icon: <IconSliders /> },
    { href: '/site/tracking', label: '추적', icon: <IconTruck />, badge: pendingOrders },
    { href: '/site/orders', label: '납품서', icon: <IconDoc /> },
  ];

  if (pending) return <Loading />;
  if (wrongRole && profile) return <WrongRole required="site" actual={profile.role} />;

  return (
    <AppShell
      roleLabel="현장"
      tabs={tabs}
      title={title}
      description={description}
      showClock={showClock}
      picker={
        <>
          <AccountChip />
          <select
            className={s.picker}
            value={site?.id ?? ''}
            onChange={(e) => setSiteId(e.target.value)}
            aria-label="현장 고르기"
          >
            {mine.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </>
      }
    >
      {site ? children(site) : <NoneYet what="현장" loaded={db.loaded} />}
    </AppShell>
  );
}

/* ==========================================================================
 * 레미콘사
 * ======================================================================== */

export function PlantShell({ title, description, showClock, children }: ShellProps<Plant>) {
  const db = useDb();
  const { demoMode, profile, pending, wrongRole } = useGate('plant');

  const mine = demoMode
    ? db.plants
    : db.plants.filter((x) => !x.companyId || x.companyId === profile?.companyId);

  const [plantId, setPlantId] = useSelection('plant', mine[0]?.id ?? '');
  const plant = mine.find((x) => x.id === plantId) ?? mine[0];

  const newOrders = db.orders.filter(
    (o) => o.plantId === plant?.id && o.status === 'requested',
  ).length;
  const toDispatch = db.orders.filter(
    (o) => o.plantId === plant?.id && o.status === 'accepted',
  ).length;

  const tabs = [
    { href: '/plant', label: '출하 현황', icon: <IconFactory /> },
    { href: '/plant/orders', label: '주문 관리', icon: <IconInbox />, badge: newOrders },
    { href: '/plant/dispatch', label: '배차', icon: <IconSend />, badge: toDispatch },
  ];

  if (pending) return <Loading />;
  if (wrongRole && profile) return <WrongRole required="plant" actual={profile.role} />;

  return (
    <AppShell
      roleLabel="레미콘사"
      tabs={tabs}
      title={title}
      description={description}
      showClock={showClock}
      picker={
        <>
          <AccountChip />
          <select
            className={s.picker}
            value={plant?.id ?? ''}
            onChange={(e) => setPlantId(e.target.value)}
            aria-label="공장 고르기"
          >
            {mine.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </>
      }
    >
      {plant ? children(plant) : <NoneYet what="공장" loaded={db.loaded} />}
    </AppShell>
  );
}

/* ==========================================================================
 * 기사
 * ======================================================================== */

export function DriverShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { profile, pending, wrongRole } = useGate('driver');
  const tabs = [{ href: '/driver', label: '내 배송', icon: <IconPin /> }];

  if (pending) return <Loading />;
  if (wrongRole && profile) return <WrongRole required="driver" actual={profile.role} />;

  return (
    <AppShell
      roleLabel="기사"
      tabs={tabs}
      title={title}
      description={description}
      picker={<AccountChip />}
    >
      {children}
    </AppShell>
  );
}

/* ==========================================================================
 * 공통 상태 화면
 * ======================================================================== */

function Loading() {
  return (
    <main className="wrap" style={{ paddingBlock: 60 }}>
      <Empty>불러오는 중…</Empty>
    </main>
  );
}

function NoneYet({ what, loaded }: { what: string; loaded: boolean }) {
  if (!loaded) return <Empty>불러오는 중…</Empty>;
  return (
    <Panel>
      <Empty>
        내 소속에 등록된 {what}이 없습니다.
        <br />
        가입할 때 고른 회사가 맞는지 확인하거나, Supabase 에서{' '}
        <code style={{ fontFamily: 'var(--font-mono)' }}>0002_seed.sql</code> 을 실행했는지
        확인하세요.
      </Empty>
    </Panel>
  );
}
