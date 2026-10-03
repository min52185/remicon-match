// 구독 요금제 — 랜딩 요금제 섹션과 신청 화면이 같이 쓴다.
// 가격은 사업성 검토 후 확정한다 — 그 전까지 금액 대신 안내 문구를 둔다.

export type PlanId = 'basic' | 'pro' | 'enterprise';

export interface Plan {
  id: PlanId;
  name: string;
  target: string;
  price: string;
  recommended?: boolean;
  /** 엔터프라이즈는 바로 시작하지 않고 협의를 거친다 */
  contactOnly?: boolean;
  features: string[];
}

export const PLANS: Plan[] = [
  {
    id: 'basic',
    name: '베이직',
    target: '소규모 현장 · 처음 쓰는 곳',
    price: '출시 시 공개',
    features: ['레미콘 주문 · 즐겨찾기 배합', '실시간 배송 추적 · 도착 예정', '전자 납품서'],
  },
  {
    id: 'pro',
    name: '프로',
    target: '타설이 잦은 중규모 현장',
    price: '출시 시 공개',
    recommended: true,
    features: ['베이직의 모든 기능', 'AI 다공장 배분 추천', '타설 모니터 · 콜드조인트 경고'],
  },
  {
    id: 'enterprise',
    name: '엔터프라이즈',
    target: '여러 현장을 운영하는 건설사',
    price: '별도 협의',
    contactOnly: true,
    features: ['프로의 모든 기능', '급처 매칭 우선 배정', '현장 통합 관리 · 공급 품질 리포트'],
  },
];

/** 주소의 ?plan= 값으로 요금제를 찾는다. 모르는 값이면 undefined */
export function findPlan(id: string | undefined): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}
