-- ============================================================================
-- 0008 — 공장이 자기 차량 목록을 관리한다
--
-- 0004 에서 차량 '만들기' 만 열었다. 고치기는 0001 의 "공장은 자기 차량을 고친다"
-- 로 이미 되지만, 지우기가 없어서 잘못 넣은 차를 뺄 수가 없었다.
--
-- 공장 등록 화면이 차량 목록을 통째로 다루게 바뀌면서 지우기가 필요해졌다.
-- 보유 대수를 숫자로 받던 것을 차량 목록으로 바꿨다 — 숫자만 저장하면 실제 차량
-- 행이 안 생겨서, 등록한 공장은 배차 화면에서 고를 차가 없었다.
--
-- 지우기는 내 회사 공장의 차량만. 운행 기록이 있는 차는 deliveries.truck_id 가
-- on delete restrict 라 DB 가 알아서 막는다 — 지난 납품서가 어느 차로 갔는지
-- 알 수 없게 되면 안 된다.
--
-- 실행: Supabase SQL Editor 에 붙여넣고 Run. 다시 돌려도 안전하다.
-- ============================================================================

drop policy if exists "내 회사 공장의 차량을 지운다" on trucks;
create policy "내 회사 공장의 차량을 지운다" on trucks for delete to authenticated
  using (
    my_role() = 'plant'
    and plant_id in (select id from plants where company_id = my_company_id())
  );


-- 확인 — 차량 정책이 4개(select·insert·update 2개·delete)면 성공
select cmd as 동작, count(*) as 개수
from pg_policies
where tablename = 'trucks'
group by cmd
order by cmd;
