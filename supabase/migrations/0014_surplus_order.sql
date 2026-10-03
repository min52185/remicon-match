-- ============================================================================
-- 0013 — 급처 매물로 생긴 주문을 알아보게 한다
--
-- 0012 로 현장이 매물을 가져가면 그 공장으로 주문이 간다. 그런데 주문 쪽에는
-- "이게 급처였다" 는 표시가 없어서 공장 화면에 그냥 '긴급' 으로만 떴다.
--
-- 더 중요한 것은 시각이다. 급처는 공장이 이미 비벼 둔 물건이라 제한시간 시계가
-- 벌써 돌고 있다. 그걸 모르면 배차할 때 "지금 비비기 시작" 으로 찍어 타설 기한이
-- 실제보다 뒤로 밀린다 — 없는 여유를 있다고 말하는 셈이고, 이 앱이 막으려는
-- 바로 그 사고다.
--
-- 실행: Supabase SQL Editor 에 붙여넣고 Run. 다시 돌려도 안전하다.
-- ============================================================================

alter table orders
  add column if not exists surplus_id uuid references surplus_listings (id) on delete set null;

alter table orders
  add column if not exists mix_started_at timestamptz;

comment on column orders.surplus_id is
  '급처 매물을 받아 생긴 주문이면 그 매물';
comment on column orders.mix_started_at is
  '이미 비벼 둔 물건이면 그 비비기 시작 시각 — 제한시간을 여기서부터 잰다';

-- 공장이 "내가 내놓은 매물이 팔렸나" 를 찾는 길
create index if not exists orders_surplus_idx on orders (surplus_id);

-- ── 확인 ──
select count(*) as 추가된_열
from information_schema.columns
where table_name = 'orders'
  and column_name in ('surplus_id', 'mix_started_at');
