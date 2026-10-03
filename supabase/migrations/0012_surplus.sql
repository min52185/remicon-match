-- ============================================================================
-- 0012 — 급처 매물
--
-- 공장이 이미 비빈 레미콘(주문 취소·출하 잔량)을 정상가보다 싸게 내놓고,
-- 현장이 주문 화면에서 보고 가져간다. 가져가면 그 공장으로 긴급 주문이 간다.
--
-- 주문(orders)과 표를 나눈 이유: 매물은 아직 주인(현장)이 없다. orders 의 RLS 는
-- "주문의 두 당사자만 본다" 인데, 매물은 모든 현장이 봐야 한다.
--
-- 가져가기는 claim_surplus() 함수로만 한다. 현장은 남의 회사 행을 고칠 수 없고,
-- 두 현장이 동시에 눌러도 한 곳만 가져가야 하기 때문이다.
--
-- 실행: Supabase SQL Editor 에 붙여넣고 Run. 다시 돌려도 안전하다.
-- ============================================================================

do $$ begin
  create type surplus_reason as enum ('cancelled', 'leftover');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type surplus_status as enum ('open', 'claimed', 'withdrawn');
exception when duplicate_object then null;
end $$;

create table if not exists surplus_listings (
  id              uuid primary key default gen_random_uuid(),
  plant_id        uuid not null references plants (id) on delete cascade,
  reason          surplus_reason not null,
  spec            jsonb not null,
  volume_m3       numeric(5, 1) not null check (volume_m3 > 0),
  -- 비비기 시작. 제한시간을 여기서부터 잰다.
  mix_start_at    timestamptz not null,
  limit_minutes   int not null,
  temp_c          numeric(4, 1) not null,
  unit_price      int not null check (unit_price > 0),
  -- 최소·최대 할인율은 lib/rules.ts 의 SURPLUS 가 화면에서 먼저 막는다.
  -- 여기서는 0~100 밖의 값만 거른다.
  discount_pct    numeric(4, 1) not null check (discount_pct > 0 and discount_pct < 100),
  note            text,
  status          surplus_status not null default 'open',
  claimed_site_id uuid references sites (id) on delete set null,
  claimed_at      timestamptz,
  created_by      uuid references profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists surplus_open_idx on surplus_listings (status, mix_start_at desc);
create index if not exists surplus_plant_idx on surplus_listings (plant_id, created_at desc);

-- ── 실시간 — 올리자마자 현장 주문 화면에 뜬다 ──
do $$ begin
  alter publication supabase_realtime add table surplus_listings;
exception when duplicate_object then null;
end $$;

-- ── 권한 ──
alter table surplus_listings enable row level security;

-- 열린 매물은 로그인한 누구나 본다. 내 회사 매물과 내 현장이 가져간 매물은 닫혀도 본다.
drop policy if exists "열린 급처 매물은 모두 본다" on surplus_listings;
create policy "열린 급처 매물은 모두 본다" on surplus_listings for select to authenticated using (
  status = 'open'
  or plant_id in (select id from plants where company_id = my_company_id())
  or claimed_site_id = my_site_id()
);

-- 내 회사 공장의 매물만 올린다
drop policy if exists "공장이 급처 매물을 올린다" on surplus_listings;
create policy "공장이 급처 매물을 올린다" on surplus_listings for insert to authenticated with check (
  plant_id in (select id from plants where company_id = my_company_id())
);

-- 내 회사 공장의 매물만 고친다 (내리기)
drop policy if exists "공장이 급처 매물을 고친다" on surplus_listings;
create policy "공장이 급처 매물을 고친다" on surplus_listings for update to authenticated using (
  plant_id in (select id from plants where company_id = my_company_id())
);

-- ── 가져가기 ──
-- 열려 있고 시한(비비기 + 제한시간 - 하역 20분)이 남은 매물만 잠근다.
-- 잠갔으면 true, 이미 누가 가져갔거나 시한이 지났으면 false.
-- 하역 20분은 lib/rules.ts 의 UNLOAD_EST_MIN 과 같아야 한다.
create or replace function claim_surplus(listing_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  site uuid := my_site_id();
  hit  int;
begin
  if site is null then
    raise exception '현장 계정만 급처 매물을 가져갈 수 있습니다.';
  end if;

  update surplus_listings
     set status = 'claimed',
         claimed_site_id = site,
         claimed_at = now()
   where id = listing_id
     and status = 'open'
     and now() < mix_start_at + make_interval(mins => limit_minutes - 20);

  get diagnostics hit = row_count;
  return hit = 1;
end $$;

revoke all on function claim_surplus(uuid) from public;
grant execute on function claim_surplus(uuid) to authenticated;

comment on table surplus_listings is '급처 매물 — 이미 비빈 레미콘을 싸게 내놓는다';
