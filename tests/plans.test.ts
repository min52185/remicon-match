import { describe, expect, it } from 'vitest';
import { PLANS, findPlan } from '../lib/plans';

describe('구독 요금제', () => {
  it('세 단계이고 id 가 겹치지 않는다', () => {
    expect(PLANS).toHaveLength(3);
    expect(new Set(PLANS.map((p) => p.id)).size).toBe(3);
  });

  it('추천 요금제는 하나뿐이다', () => {
    expect(PLANS.filter((p) => p.recommended)).toHaveLength(1);
  });

  it('id 로 요금제를 찾는다', () => {
    expect(findPlan('pro')?.name).toBe('프로');
  });

  it('모르는 값이나 빈 값이면 찾지 않는다', () => {
    expect(findPlan('gold')).toBeUndefined();
    expect(findPlan(undefined)).toBeUndefined();
  });
});
