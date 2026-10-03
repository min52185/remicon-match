'use client';

/**
 * 지금 현장 기온 한 줄.
 *
 * 그냥 숫자만 띄우면 쓸모가 반이다. 이 앱에서 기온이 중요한 이유는 하나뿐 —
 * 25℃ 를 넘느냐에 따라 비비기~타설 제한이 90분이냐 120분이냐가 갈리기 때문이다.
 * 그래서 주문할 때 기록한 온도(recordedC)를 같이 주면, 그 경계를 넘었는지까지 본다.
 *
 * 넘었을 때만 말한다. 1~2도 오르내린 것은 알릴 일이 아니다.
 */

import { PourRules, RULES } from '@/lib/rules';
import { useTemperature } from '@/lib/useTemperature';
import type { LatLng } from '@/lib/types';
import { Tag } from './ui';

interface Props {
  /** 어느 지점의 기온인가 — 현장 좌표 */
  at: LatLng | null | undefined;
  /**
   * 주문할 때 기록해 제한시간을 정한 온도.
   * 주면 지금 기온이 25℃ 경계를 건넜는지 함께 본다.
   */
  recordedC?: number;
  /** 라벨을 빼고 값만 — 이미 "외기온도" 같은 제목 옆에 붙일 때 */
  bare?: boolean;
}

export default function TempNow({ at, recordedC, bare }: Props) {
  const temp = useTemperature(at);

  if (!temp) {
    return <span style={{ color: 'var(--color-concrete-mid)' }}>기온 받는 중…</span>;
  }

  const crossed =
    recordedC != null && PourRules.isHot(temp.tempC) !== PourRules.isHot(recordedC);

  return (
    <>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        {!bare && <span style={{ color: 'var(--color-concrete-mid)' }}>지금</span>}
        <strong style={{ fontFamily: 'var(--font-mono)' }}>{temp.tempC}℃</strong>
        <Tag tone={temp.source === 'kma' ? 'ok' : 'warn'}>
          {temp.source === 'kma' ? '기상청' : '평년값 근사 [가정]'}
        </Tag>
        {crossed && <Tag tone="bad">제한 바뀜</Tag>}
      </span>

      {crossed && recordedC != null && (
        <p
          style={{
            fontSize: '0.78rem',
            lineHeight: 1.55,
            color: 'var(--color-bad)',
            margin: '6px 0 0',
          }}
        >
          주문할 때 {recordedC}℃ 로 <strong>{PourRules.limitMinutes(recordedC)}분</strong> 제한을
          받았는데, 지금은 {temp.tempC}℃ 라 기준이 <strong>{PourRules.limitMinutes(temp.tempC)}분</strong>{' '}
          입니다. {RULES.HOT_THRESHOLD_C}℃ 를{' '}
          {PourRules.isHot(temp.tempC) ? '넘었습니다' : '밑돕니다'}. 남은 차량의 타설 기한을 다시
          보세요.
        </p>
      )}
    </>
  );
}
