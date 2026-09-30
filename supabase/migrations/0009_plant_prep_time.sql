-- ============================================================================
-- 0009 — 공장별 상차 준비시간
--
-- 긴급주문의 자동 매칭은 "가장 빨리 오는 공장" 을 고른다.
--   도착 예상 = 지금 + 비비기·상차 시간 + 이동시간(실시간 교통)
--
-- 그런데 준비시간이 모든 공장에서 10분 고정이었다. 그러면 세 항 중 가운데가
-- 상수라서 사실상 이동시간 순으로 고르는 것과 결과가 같다. "비비기 시작까지
-- 고려한다" 는 말이 성립하지 않는다.
--
-- 실제로는 공장마다 다르다. 믹서가 비어 있으면 5분, 앞 주문을 비비는 중이면
-- 20분 넘게 걸린다. 설비 수와 배치 대기열에 달렸다.
--
-- 기본값은 기존 동작과 같은 10분이다. 공장이 등록·수정 화면에서 자기 값으로
-- 고치면 그때부터 매칭에 반영된다.
--
-- 실행: Supabase SQL Editor 에 붙여넣고 Run. 다시 돌려도 안전하다.
-- ============================================================================

alter table plants
  add column if not exists prep_minutes int not null default 10;

comment on column plants.prep_minutes is
  '상차 준비시간(분) — 주문을 받고 비비기를 시작해 차가 공장을 나서기까지';

-- 0 분이나 터무니없이 큰 값이 들어가지 않게
do $$ begin
  alter table plants add constraint plants_prep_minutes_range
    check (prep_minutes between 1 and 120);
exception when duplicate_object then null; end $$;


-- 확인 — 1 이 나오면 성공
select count(*) as 준비시간_열
from information_schema.columns
where table_name = 'plants' and column_name = 'prep_minutes';
