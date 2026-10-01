-- 현장 계정을 현장 하나에 묶는다.
--
-- 지금까지는 계정이 "회사"에 묶여 있었다. 그래서 한 건설사의 계정이면 그 회사의
-- 모든 현장을 드롭다운으로 오갈 수 있었고, 더 나쁘게는 sites 읽기 권한이
-- `using (true)` 라서 로그인한 사람은 누구나 모든 회사의 현장을 읽을 수 있었다.
-- 화면에서 걸러 보이지 않았을 뿐, 직접 부르면 다 나왔다.
--
-- 이 파일이 바꾸는 것
--   1. profiles.site_id — 현장 계정이 맡은 현장 하나
--   2. my_site_id() — 정책에서 쓰는 도우미
--   3. sites 읽기를 좁힌다 (아래 "무엇이 보이나")
--   4. 주문·배송·배분·즐겨찾기·위치 정책을 회사 단위에서 현장 단위로 좁힌다
--
-- 무엇이 보이나 (sites)
--   · 내 현장                     — 언제나
--   · 거래한 공장                 — 그 현장과 주문을 주고받았을 때만
--   · 배송 중인 기사              — 그 현장으로 가는 배송이 있을 때만
--   · 같은 건설사의 다른 현장     — 가입할 때 고르고 나중에 옮기려면 목록이 필요하다.
--                                   이름·주소까지다. 주문·배송·납품서 같은 실제
--                                   자료는 아래 정책이 내 현장 것만 남긴다.
--   · 다른 건설사                 — 전혀 안 보인다
--
-- 공장과 기사를 왜 여느냐: 주문을 받은 공장은 현장 좌표가 있어야 경로를 짜고,
-- 기사는 주소가 있어야 간다. 막으면 배송 자체가 돌지 않는다.

-- ──────────────────────────────────────────────────────────────
-- 1. 계정이 맡은 현장
-- ──────────────────────────────────────────────────────────────

alter table profiles
  add column if not exists site_id uuid references sites (id) on delete set null;

comment on column profiles.site_id is
  '현장 계정이 맡은 현장. 공장·기사 계정은 비어 있다.';

create index if not exists profiles_site_id_idx on profiles (site_id);

-- ──────────────────────────────────────────────────────────────
-- 2. 정책 도우미
--
-- 전부 security definer 다. 정책 안에서 다른 테이블을 그냥 조회하면 그 테이블의
-- 정책이 또 돌고, sites ↔ orders 처럼 서로를 참조하면 무한 재귀로 터진다.
-- definer 함수는 그 고리를 끊는다.
-- ──────────────────────────────────────────────────────────────

create or replace function my_site_id() returns uuid
language sql stable security definer set search_path = public as $$
  select site_id from profiles where id = auth.uid()
$$;

-- 내 회사(레미콘사)가 이 현장과 주문을 주고받았나
create or replace function trades_with_site(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from orders o
    join plants p on p.id = o.plant_id
    where o.site_id = target
      and p.company_id = my_company_id()
  )
$$;

-- 내가 이 현장으로 가는 배송을 맡은 기사인가
create or replace function drives_to_site(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from deliveries d
    join orders o on o.id = d.order_id
    join trucks t on t.id = d.truck_id
    where o.site_id = target
      and t.driver_id = auth.uid()
  )
$$;

-- ──────────────────────────────────────────────────────────────
-- 3. 현장 읽기
-- ──────────────────────────────────────────────────────────────

drop policy if exists "로그인 사용자는 현장을 본다" on sites;
drop policy if exists "현장은 내 현장만 본다" on sites;
create policy "현장은 내 현장만 본다" on sites for select to authenticated using (
  id = my_site_id()
  or trades_with_site(id)
  or drives_to_site(id)
  or (my_role() = 'site' and company_id = my_company_id())
);

-- 현장 고치기도 내 현장만 (등록은 0004 의 회사 단위 정책을 그대로 둔다 —
-- 새 현장을 만들어야 거기에 들어갈 수 있다)
drop policy if exists "현장은 자기 회사 현장을 고친다" on sites;
drop policy if exists "현장은 내 현장만 고친다" on sites;
create policy "현장은 내 현장만 고친다" on sites for update to authenticated
  using (my_role() = 'site' and id = my_site_id())
  with check (my_role() = 'site' and id = my_site_id());

-- ──────────────────────────────────────────────────────────────
-- 4. 실제 자료 — 회사 단위에서 현장 단위로
--
-- my_site_id() 는 공장·기사 계정에서 null 이다. `site_id = null` 은 참이 아니라
-- null 이므로 그 가지는 그냥 떨어지고, 뒤에 오는 공장·기사 가지가 판단한다.
-- ──────────────────────────────────────────────────────────────

-- 즐겨찾기
drop policy if exists "현장은 자기 즐겨찾기를 쓴다" on favorite_mixes;
create policy "현장은 자기 즐겨찾기를 쓴다" on favorite_mixes for all to authenticated
  using (site_id = my_site_id())
  with check (site_id = my_site_id());

-- 주문
drop policy if exists "주문은 양쪽 당사자만 본다" on orders;
create policy "주문은 양쪽 당사자만 본다" on orders for select to authenticated using (
  site_id = my_site_id()
  or plant_id in (select id from plants where company_id = my_company_id())
);

drop policy if exists "현장만 주문을 만든다" on orders;
create policy "현장만 주문을 만든다" on orders for insert to authenticated with check (
  my_role() = 'site' and site_id = my_site_id()
);

drop policy if exists "양쪽 당사자가 주문 상태를 바꾼다" on orders;
create policy "양쪽 당사자가 주문 상태를 바꾼다" on orders for update to authenticated using (
  site_id = my_site_id()
  or plant_id in (select id from plants where company_id = my_company_id())
);

-- 배분 계획
drop policy if exists "현장은 자기 배분 계획을 쓴다" on allocation_plans;
create policy "현장은 자기 배분 계획을 쓴다" on allocation_plans for all to authenticated
  using (site_id = my_site_id())
  with check (site_id = my_site_id());

-- 배분 항목
drop policy if exists "배분 항목은 계획을 따라간다" on plan_items;
create policy "배분 항목은 계획을 따라간다" on plan_items for select to authenticated using (
  plan_id in (select id from allocation_plans where site_id = my_site_id())
  or plant_id in (select id from plants where company_id = my_company_id())
);

drop policy if exists "현장이 배분 항목을 만든다" on plan_items;
create policy "현장이 배분 항목을 만든다" on plan_items for insert to authenticated with check (
  plan_id in (select id from allocation_plans where site_id = my_site_id())
);

-- 배송
drop policy if exists "배송은 당사자와 기사가 본다" on deliveries;
create policy "배송은 당사자와 기사가 본다" on deliveries for select to authenticated using (
  order_id in (
    select id from orders
    where site_id = my_site_id()
       or plant_id in (select id from plants where company_id = my_company_id())
  )
  or truck_id in (select id from trucks where driver_id = auth.uid())
);

drop policy if exists "당사자와 기사가 배송을 고친다" on deliveries;
create policy "당사자와 기사가 배송을 고친다" on deliveries for update to authenticated using (
  order_id in (
    select id from orders
    where site_id = my_site_id()
       or plant_id in (select id from plants where company_id = my_company_id())
  )
  or truck_id in (select id from trucks where driver_id = auth.uid())
);

-- GPS 위치
drop policy if exists "위치는 당사자가 본다" on truck_locations;
create policy "위치는 당사자가 본다" on truck_locations for select to authenticated using (
  delivery_id in (
    select d.id from deliveries d
    join orders o on o.id = d.order_id
    where o.site_id = my_site_id()
       or o.plant_id in (select id from plants where company_id = my_company_id())
  )
  or delivery_id in (
    select d.id from deliveries d
    join trucks t on t.id = d.truck_id
    where t.driver_id = auth.uid()
  )
);

-- ──────────────────────────────────────────────────────────────
-- 5. 이미 가입한 현장 계정
--
-- 현장이 하나뿐인 회사는 자동으로 묶어 준다. 둘 이상이면 사람이 골라야 하므로
-- 비워 두고, 앱이 다음 로그인 때 "현장 고르기" 화면을 띄운다.
-- ──────────────────────────────────────────────────────────────

update profiles p
set site_id = s.id
from sites s
where p.role = 'site'
  and p.site_id is null
  and s.company_id = p.company_id
  and (select count(*) from sites x where x.company_id = p.company_id) = 1;
