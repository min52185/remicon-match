-- ============================================================================
-- 0006 — 현장이 자기 현장으로 오는 기사를 볼 수 있게
--
-- 0004 에서 profiles 읽기를 "같은 회사" 까지만 열었다. 그런데 현장(건설사)과
-- 기사(레미콘사)는 회사가 다르다. 그래서 현장이 기사의 photo_path 를 못 읽고,
-- 경로를 모르니 얼굴 사진을 띄울 수가 없다.
--
-- 사진 저장소(0005) 정책은 이 경우를 이미 허용하고 있었다 — 파일은 열리는데
-- 어디 있는지를 모르는 상태였다.
--
-- 여는 범위는 0005 의 Storage 정책과 똑같이 맞춘다.
--   "지금 내 현장으로 배송 중인 차의 기사" 한 명씩만.
-- 아무 기사나 들여다볼 수는 없고, 배송이 끝나고 지워지면 다시 안 보인다.
--
-- 이름·전화번호도 같이 읽힌다. 이건 의도한 것이다 — 차가 안 오면 현장이
-- 기사에게 직접 전화해야 한다. 그 범위를 넘는 사람은 한 줄도 못 읽는다.
--
-- 실행: Supabase SQL Editor 에 붙여넣고 Run. 다시 돌려도 안전하다.
-- ============================================================================

drop policy if exists "같은 회사 사람을 본다" on profiles;
create policy "같은 회사 사람을 본다" on profiles for select to authenticated using (
  -- 나 자신
  id = auth.uid()

  -- 같은 회사 사람
  or (my_company_id() is not null and company_id = my_company_id())

  -- 지금 내 현장으로 오는 기사 (회사가 달라도)
  or id in (
    select t.driver_id
    from deliveries d
    join trucks t on t.id = d.truck_id
    join orders o on o.id = d.order_id
    join sites  s on s.id = o.site_id
    where s.company_id = my_company_id()
      and t.driver_id is not null
  )
);


-- 확인 — 1 이 나오면 성공
select count(*) as 프로필_읽기_정책
from pg_policies
where tablename = 'profiles' and cmd = 'SELECT';
