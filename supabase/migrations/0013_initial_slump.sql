-- ============================================================================
-- 0013 — 출하 때의 초기 슬럼프
--
-- 공장이 출하 지시를 내리면서 그 차에 실은 레미콘의 슬럼프(mm)를 적는다.
-- 레캉쌤이 운반 중 슬럼프를 추정하는 출발점이다(lib/ai/slump.ts).
-- 비어 있으면 주문한 슬럼프로 본다.
--
-- 기존 RLS(배송은 당사자와 기사가 본다·고친다)가 그대로 적용된다 — 같은 표의 칸 하나다.
--
-- 실행: Supabase SQL Editor 에 붙여넣고 Run. 다시 돌려도 안전하다.
-- ============================================================================

alter table deliveries add column if not exists initial_slump_mm int
  check (initial_slump_mm is null or (initial_slump_mm > 0 and initial_slump_mm <= 900));

comment on column deliveries.initial_slump_mm is '출하 때 공장이 적은 초기 슬럼프(mm) — 운반 중 슬럼프 추정의 출발점';
