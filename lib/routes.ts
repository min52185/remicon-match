import type { Role } from './types';

/** 로그인 후 역할별로 처음 열리는 화면 */
export const HOME_BY_ROLE: Record<Role, string> = {
  site: '/site',
  plant: '/plant',
  driver: '/driver',
};

export const ROLE_LABEL: Record<Role, string> = {
  site: '현장',
  plant: '레미콘사',
  driver: '기사',
};

export const ROLE_DESC: Record<Role, string> = {
  site: '현황 · 주문 · AI 배분 · 배송 추적 · 납품서',
  plant: '출하 현황 · 주문 수락 · 배차',
  driver: '내 배송 · 운행 시작(GPS)',
};
