-- ============================================================================
-- 0003 — 긴급 배차 요청
--
-- 현장이 타설 공백을 발견했을 때 보내는 주문이다. 별도 테이블을 만들지 않은 이유:
-- 긴급이라고 해서 수락 → 배차 → 납품서 흐름이 달라지지 않는다. 다른 것은
-- "공장 화면에서 맨 위로 올라가고, 왜 급한지 이유가 붙는다"는 것뿐이다.
-- 테이블을 나누면 두 흐름을 양쪽에서 똑같이 관리해야 한다.
--
-- 기존 RLS 정책(주문은 양쪽 당사자만 본다 / 현장만 주문을 만든다)이 그대로 적용된다.
-- 새 정책은 필요 없다 — 같은 테이블이기 때문이다.
--
-- 실행: Supabase SQL Editor 에 붙여넣고 Run.
--       이미 돌린 뒤에 다시 돌려도 안전하다 (if not exists).
-- ============================================================================

alter table orders add column if not exists urgent boolean not null default false;
alter table orders add column if not exists urgent_reason text;

-- 공장 화면은 "내 공장의 수락 대기 중인 긴급 주문"만 찾는다
create index if not exists orders_urgent_idx
  on orders (plant_id, status)
  where urgent;

comment on column orders.urgent is '긴급 배차 요청으로 들어온 주문';
comment on column orders.urgent_reason is '왜 급한지 — 예: 다음 차까지 42분 공백';
