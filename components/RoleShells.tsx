'use client';

/**
 * 역할별 화면 껍데기. 상단 바·하단 탭·현장(공장) 고르기를 한 군데서 맡는다.
 *
 * children 을 함수로 받는 이유: 위에서 고른 현장/공장 id 를 아래 화면이 그대로 써야 하는데,
 * 껍데기가 children 을 감싸는 구조라 context 로는 페이지가 읽을 수 없기 때문이다.
 */

import type { ReactNode } from 'react';
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
import { useDb, useSelection } from '@/lib/store/hooks';
import type { Plant, Site } from '@/lib/types';
import s from './AppShell.module.css';

interface ShellProps<T> {
  title: string;
  description?: string;
  showClock?: boolean;
  children: (selected: T) => ReactNode;
}

/* ==========================================================================
 * 현장
 * ======================================================================== */

export function SiteShell({ title, description, showClock, children }: ShellProps<Site>) {
  const db = useDb();
  const [siteId, setSiteId] = useSelection('site', db.sites[0]?.id ?? 's1');
  const site = db.sites.find((x) => x.id === siteId) ?? db.sites[0];

  const pending = db.orders.filter(
    (o) => o.siteId === site?.id && (o.status === 'requested' || o.status === 'accepted'),
  ).length;

  const tabs = [
    { href: '/site/order', label: '주문', icon: <IconOrder /> },
    { href: '/site/favorites', label: '즐겨찾기', icon: <IconStar /> },
    { href: '/site/allocate', label: 'AI 배분', icon: <IconSliders /> },
    { href: '/site/tracking', label: '추적', icon: <IconTruck />, badge: pending },
    { href: '/site/orders', label: '납품서', icon: <IconDoc /> },
  ];

  return (
    <AppShell
      roleLabel="현장"
      tabs={tabs}
      title={title}
      description={description}
      showClock={showClock}
      picker={
        <select
          className={s.picker}
          value={site?.id ?? ''}
          onChange={(e) => setSiteId(e.target.value)}
          aria-label="현장 고르기"
        >
          {db.sites.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      }
    >
      {site ? children(site) : <p>현장이 없습니다.</p>}
    </AppShell>
  );
}

/* ==========================================================================
 * 레미콘사
 * ======================================================================== */

export function PlantShell({ title, description, showClock, children }: ShellProps<Plant>) {
  const db = useDb();
  const [plantId, setPlantId] = useSelection('plant', db.plants[0]?.id ?? 'p01');
  const plant = db.plants.find((x) => x.id === plantId) ?? db.plants[0];

  const newOrders = db.orders.filter((o) => o.plantId === plant?.id && o.status === 'requested').length;
  const toDispatch = db.orders.filter((o) => o.plantId === plant?.id && o.status === 'accepted').length;

  const tabs = [
    { href: '/plant', label: '출하 현황', icon: <IconFactory /> },
    { href: '/plant/orders', label: '주문 관리', icon: <IconInbox />, badge: newOrders },
    { href: '/plant/dispatch', label: '배차', icon: <IconSend />, badge: toDispatch },
  ];

  return (
    <AppShell
      roleLabel="레미콘사"
      tabs={tabs}
      title={title}
      description={description}
      showClock={showClock}
      picker={
        <select
          className={s.picker}
          value={plant?.id ?? ''}
          onChange={(e) => setPlantId(e.target.value)}
          aria-label="공장 고르기"
        >
          {db.plants.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      }
    >
      {plant ? children(plant) : <p>공장이 없습니다.</p>}
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
  const tabs = [{ href: '/driver', label: '내 배송', icon: <IconPin /> }];
  return (
    <AppShell roleLabel="기사" tabs={tabs} title={title} description={description}>
      {children}
    </AppShell>
  );
}
