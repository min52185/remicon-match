/**
 * 사양 직접입력 검사.
 *
 * KS F 4009 표 밖 조합을 막지 않는 것이 핵심이다 — 고강도 45MPa, 골재 15mm 는
 * 표에 없지만 협의로 생산한다. 막으면 쓸 수 없는 화면이 된다.
 * 대신 물리적으로 말이 안 되는 값만 걸러 낸다.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_SPEC, SPEC_LIMITS, isKsSpec, specCode, validateSpec } from '../lib/rules';
import type { Spec } from '../lib/types';

const spec = (over: Partial<Spec> = {}): Spec => ({ ...DEFAULT_SPEC, ...over });

describe('validateSpec — 표 밖이라고 막지는 않는다', () => {
  it('기본값은 통과한다', () => {
    expect(validateSpec(DEFAULT_SPEC)).toBeNull();
  });

  it('KS 표에 없어도 범위 안이면 통과한다', () => {
    // 보통 콘크리트에 골재 15mm 는 표에 없다 (표는 20·25·40 만 둔다)
    const odd = spec({ type: '보통', aggMm: 15, strength: 24, slumpMm: 150 });
    expect(isKsSpec(odd)).toBe(false); // 표에는 없고
    expect(validateSpec(odd)).toBeNull(); // 그래도 주문은 된다
    expect(specCode(odd)).toBe('15-24-150');
  });

  it('고강도 15-45-180 은 표 안이다 — 표 밖처럼 보여도 확인하고 쓴다', () => {
    const s = spec({ type: '고강도', aggMm: 15, strength: 45, slumpMm: 180 });
    expect(isKsSpec(s)).toBe(true);
  });
});

describe('validateSpec — 굵은골재', () => {
  const L = SPEC_LIMITS;

  it('범위 경계는 허용한다', () => {
    expect(validateSpec(spec({ aggMm: L.AGG_MIN_MM }))).toBeNull();
    expect(validateSpec(spec({ aggMm: L.AGG_MAX_MM }))).toBeNull();
  });

  it('범위를 벗어나면 막는다', () => {
    expect(validateSpec(spec({ aggMm: L.AGG_MIN_MM - 1 }))).toContain('굵은골재');
    expect(validateSpec(spec({ aggMm: L.AGG_MAX_MM + 1 }))).toContain('굵은골재');
  });

  it('정수가 아니면 막는다 — 체가 정수 치수로만 나온다', () => {
    expect(validateSpec(spec({ aggMm: 22.5 }))).toContain('정수');
    expect(validateSpec(spec({ aggMm: NaN }))).toContain('굵은골재');
  });
});

describe('validateSpec — 강도', () => {
  const L = SPEC_LIMITS;

  it('0 이하는 막고 상한은 허용한다', () => {
    expect(validateSpec(spec({ strength: 0 }))).toContain('호칭강도');
    expect(validateSpec(spec({ strength: -5 }))).toContain('호칭강도');
    expect(validateSpec(spec({ strength: L.STRENGTH_MAX_MPA }))).toBeNull();
    expect(validateSpec(spec({ strength: L.STRENGTH_MAX_MPA + 1 }))).toContain('호칭강도');
  });

  it('포장은 휨강도라고 부른다', () => {
    const msg = validateSpec(spec({ type: '포장', strength: 0 }));
    expect(msg).toContain('휨강도');
    expect(msg).not.toContain('호칭강도');
  });

  it('포장의 소수 휨강도(4.5MPa)는 통과한다', () => {
    expect(validateSpec(spec({ type: '포장', aggMm: 40, strength: 4.5, slumpMm: 65 }))).toBeNull();
  });
});

describe('validateSpec — 슬럼프와 슬럼프 플로는 기준이 다르다', () => {
  const L = SPEC_LIMITS;

  it('슬럼프 범위', () => {
    expect(validateSpec(spec({ slumpKind: 'slump', slumpMm: L.SLUMP_MIN_MM }))).toBeNull();
    expect(validateSpec(spec({ slumpKind: 'slump', slumpMm: L.SLUMP_MAX_MM }))).toBeNull();
    expect(validateSpec(spec({ slumpKind: 'slump', slumpMm: L.SLUMP_MAX_MM + 1 }))).toContain(
      '슬럼프',
    );
  });

  it('슬럼프 플로 범위 — 슬럼프로는 통과하는 값도 플로로는 막힌다', () => {
    expect(validateSpec(spec({ slumpKind: 'flow', slumpMm: 600 }))).toBeNull();
    expect(validateSpec(spec({ slumpKind: 'flow', slumpMm: 180 }))).toContain('슬럼프 플로');
    // 같은 180mm 가 슬럼프로는 멀쩡하다
    expect(validateSpec(spec({ slumpKind: 'slump', slumpMm: 180 }))).toBeNull();
  });

  it('경계값', () => {
    expect(validateSpec(spec({ slumpKind: 'flow', slumpMm: L.FLOW_MIN_MM }))).toBeNull();
    expect(validateSpec(spec({ slumpKind: 'flow', slumpMm: L.FLOW_MAX_MM }))).toBeNull();
    expect(validateSpec(spec({ slumpKind: 'flow', slumpMm: L.FLOW_MAX_MM + 1 }))).toContain(
      '슬럼프 플로',
    );
  });
});

describe('validateSpec — 시멘트', () => {
  it('비어 있으면 막는다', () => {
    expect(validateSpec(spec({ cement: '' }))).toContain('시멘트');
  });
});
