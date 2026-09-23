'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { simClock } from '../services/clock';
import { store, type Db } from './index';

/** 저장소를 구독한다. 다른 탭에서 바뀌어도 여기로 들어온다. */
export function useDb(): Db {
  return useSyncExternalStore(store.subscribe, store.snapshot, store.serverSnapshot);
}

/**
 * 시연 시계의 "지금".
 * intervalMs 마다 다시 그린다. 배속을 올리면 시계가 빨리 가므로 화면도 따라간다.
 * 서버 렌더에서는 0 을 돌려주고, 마운트된 뒤에 실제 시각으로 바뀐다 (hydration 불일치 방지).
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(simClock.now());
    const id = window.setInterval(() => setNow(simClock.now()), intervalMs);
    const off = simClock.subscribe(() => setNow(simClock.now()));
    return () => {
      window.clearInterval(id);
      off();
    };
  }, [intervalMs]);

  return now;
}

/** 클라이언트에서 마운트됐는지 — 지도·시각처럼 서버에서 그릴 수 없는 것에 쓴다 */
export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

/** 현재 역할에서 고른 현장/공장 id 를 기억한다 */
export function useSelection(key: string, fallback: string) {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`remicon.sel.${key}`);
      if (saved) setValue(saved);
    } catch {
      /* 무시 */
    }
  }, [key]);

  const set = (v: string) => {
    setValue(v);
    try {
      window.localStorage.setItem(`remicon.sel.${key}`, v);
    } catch {
      /* 무시 */
    }
  };

  return [value, set] as const;
}
