-- ============================================================================
-- 레미콘 매칭 플랫폼 — 스키마 + 권한 (지시서 4장)
--
-- 붙여넣는 곳: Supabase 대시보드 → 왼쪽 SQL Editor → New query → 전체 붙여넣고 Run.
-- 여러 번 실행해도 안전하게 만들었다(이미 있으면 건너뛴다).
--
-- 이 파일 다음에 0002_seed.sql 을 실행해야 공장·현장 데이터가 들어간다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. 열거형 — 이미 있으면 넘어간다
-- ---------------------------------------------------------------------------

do $$ begin
  create type company_kind as enum ('건설사', '레미콘사');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_role as enum ('site', 'plant', 'driver', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum
    ('requested', 'accepted', 'delivering', 'completed', 'rejected', 'cancelled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 1. 회사 · 계정
-- ---------------------------------------------------------------------------

create table if not exists companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        company_kind not null,
  created_at  timestamptz not null default now()
);

-- 로그인 계정과 1:1. 아래 트리거가 회원가입 때 자동으로 한 줄 만든다.
create table if not exists profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null,
  role        user_role not null default 'site',
  company_id  uuid references companies (id) on delete set null,
  phone       text,
  created_at  timestamptz not null default now()
);

-- 회원가입 시 프로필 자동 생성.
-- 가입 폼이 넘긴 이름·역할·회사(raw_user_meta_data)를 그대로 옮긴다.
-- 이게 없으면 로그인해도 프로필이 없어 아래 RLS 가 전부 막힌다.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, role, company_id, phone)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)),
    coalesce((nullif(new.raw_user_meta_data ->> 'role', ''))::user_role, 'site'),
    (nullif(new.raw_user_meta_data ->> 'company_id', ''))::uuid,
    nullif(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. 현장 · 공장 · 차량
-- ---------------------------------------------------------------------------

create table if not exists sites (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references companies (id) on delete cascade,
  name        text not null,
  address     text not null,
  lat         double precision not null,
  lng         double precision not null,
  access_note text,
  created_at  timestamptz not null default now()
);

create table if not exists plants (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references companies (id) on delete cascade,
  name        text not null,
  address     text not null,
  lat         double precision not null,
  lng         double precision not null,
  phone       text,
  -- { "maxStrength": {"보통":35}, "aggs":[20,25], "flow":true, "cements":[...] }
  capability  jsonb not null default '{}'::jsonb,
  fleet_size  int not null default 0,
  -- 한 현장으로 시간당 내보낼 수 있는 최대 대수 (지시서 6장 제약 ③)
  hourly_rate int not null default 4,
  created_at  timestamptz not null default now()
);

-- 공장이 수시로 고치는 값만 따로 둔다 (실시간 구독 대상)
create table if not exists plant_status (
  plant_id         uuid primary key references plants (id) on delete cascade,
  available_trucks int not null default 0,
  available_volume numeric(10, 1) not null default 0,
  is_open          boolean not null default true,
  updated_at       timestamptz not null default now()
);

create table if not exists trucks (
  id          uuid primary key default gen_random_uuid(),
  plant_id    uuid not null references plants (id) on delete cascade,
  no          int not null,
  plate_no    text not null,
  capacity_m3 numeric(5, 1) not null default 6,
  driver_id   uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (plant_id, no)
);

-- ---------------------------------------------------------------------------
-- 3. 즐겨찾기 (지시서 5장)
-- ---------------------------------------------------------------------------

create table if not exists favorite_mixes (
  id                 uuid primary key default gen_random_uuid(),
  site_id            uuid not null references sites (id) on delete cascade,
  alias              text not null,
  spec               jsonb not null,
  volume_m3          numeric(10, 1) not null,
  pump_rate          numeric(6, 1) not null,
  preferred_plant_id uuid references plants (id) on delete set null,
  note               text,
  use_count          int not null default 0,
  created_by         uuid references profiles (id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists favorite_mixes_site_idx on favorite_mixes (site_id, use_count desc);

-- ---------------------------------------------------------------------------
-- 4. AI 배분
-- ---------------------------------------------------------------------------

create table if not exists allocation_plans (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references sites (id) on delete cascade,
  total_volume_m3 numeric(10, 1) not null,
  pour_start_at   timestamptz not null,
  pump_rate       numeric(6, 1) not null,
  temp_c          numeric(4, 1) not null,
  summary         text,
  created_by      uuid references profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

create table if not exists plan_items (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references allocation_plans (id) on delete cascade,
  plant_id       uuid not null references plants (id) on delete cascade,
  trucks         int not null,
  travel_minutes numeric(6, 1) not null,
  rounds         int[] not null default '{}',
  mix_start_ats  timestamptz[] not null default '{}'
);

-- ---------------------------------------------------------------------------
-- 5. 주문 · 배송
-- ---------------------------------------------------------------------------

create table if not exists orders (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  site_id       uuid not null references sites (id) on delete cascade,
  plant_id      uuid not null references plants (id) on delete cascade,
  spec          jsonb not null,
  volume_m3     numeric(10, 1) not null,
  pour_start_at timestamptz not null,
  pump_rate     numeric(6, 1) not null,
  temp_c        numeric(4, 1) not null,
  status        order_status not null default 'requested',
  plan_id       uuid references allocation_plans (id) on delete set null,
  reject_reason text,
  note          text,
  created_by    uuid references profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists orders_site_idx on orders (site_id, created_at desc);
create index if not exists orders_plant_idx on orders (plant_id, status, created_at desc);

-- 납품서 한 장 = 트럭 1회
create table if not exists deliveries (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders (id) on delete cascade,
  truck_id       uuid not null references trucks (id) on delete restrict,
  volume_m3      numeric(5, 1) not null,
  mix_start_at   timestamptz not null,
  depart_at      timestamptz not null,
  eta_initial_at timestamptz not null,
  eta_current_at timestamptz not null,
  arrive_at      timestamptz,
  completed_at   timestamptz,
  limit_minutes  int not null,
  travel_minutes numeric(6, 1) not null,
  distance_km    numeric(7, 1),
  -- 추천 경로 [[lat,lng], ...] — 지도에 그대로 그린다
  path           jsonb not null default '[]'::jsonb,
  delay_reason   text,
  sim_seed       text,
  created_at     timestamptz not null default now()
);

create index if not exists deliveries_order_idx on deliveries (order_id, mix_start_at);

-- GPS 기록. 지시서 4장: 버리지 않는다 — 지연 예측 학습 데이터가 된다.
create table if not exists truck_locations (
  id          bigserial primary key,
  delivery_id uuid not null references deliveries (id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  speed_kmh   numeric(6, 1),
  heading     numeric(6, 1),
  recorded_at timestamptz not null default now()
);

create index if not exists truck_locations_delivery_idx
  on truck_locations (delivery_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- 6. 실시간 구독 (Realtime)
--   기사 폰이 위치를 쓰면 현장 화면에 즉시 밀어주는 통로.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'orders', 'deliveries', 'truck_locations', 'plant_status', 'plan_items', 'allocation_plans'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. 권한 (RLS)
--   현장 계정은 자기 현장 주문만, 공장 계정은 자기 공장으로 온 주문만,
--   기사는 자기 배송만 읽고 쓴다.
-- ---------------------------------------------------------------------------

alter table companies        enable row level security;
alter table profiles         enable row level security;
alter table sites            enable row level security;
alter table plants           enable row level security;
alter table plant_status     enable row level security;
alter table trucks           enable row level security;
alter table favorite_mixes   enable row level security;
alter table allocation_plans enable row level security;
alter table plan_items       enable row level security;
alter table orders           enable row level security;
alter table deliveries       enable row level security;
alter table truck_locations  enable row level security;

-- 내 프로필의 회사 id
create or replace function my_company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from profiles where id = auth.uid()
$$;

-- 내 역할
create or replace function my_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

-- 주문하려면 공장을 찾아야 하므로, 목록성 데이터는 로그인 사용자에게 열어 둔다
drop policy if exists "로그인 사용자는 회사를 본다" on companies;
create policy "로그인 사용자는 회사를 본다" on companies for select to authenticated using (true);

drop policy if exists "로그인 사용자는 현장을 본다" on sites;
create policy "로그인 사용자는 현장을 본다" on sites for select to authenticated using (true);

drop policy if exists "로그인 사용자는 공장을 본다" on plants;
create policy "로그인 사용자는 공장을 본다" on plants for select to authenticated using (true);

drop policy if exists "로그인 사용자는 출하현황을 본다" on plant_status;
create policy "로그인 사용자는 출하현황을 본다" on plant_status for select to authenticated using (true);

drop policy if exists "로그인 사용자는 차량을 본다" on trucks;
create policy "로그인 사용자는 차량을 본다" on trucks for select to authenticated using (true);

-- 프로필 — 트리거가 만들지만, 못 만든 경우를 대비해 본인 것은 직접 만들고 고칠 수 있게
drop policy if exists "내 프로필" on profiles;
create policy "내 프로필" on profiles for select to authenticated using (id = auth.uid());

drop policy if exists "내 프로필 생성" on profiles;
create policy "내 프로필 생성" on profiles for insert to authenticated with check (id = auth.uid());

drop policy if exists "내 프로필 수정" on profiles;
create policy "내 프로필 수정" on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- 공장 계정만 자기 공장 출하현황을 고친다
drop policy if exists "공장은 자기 출하현황을 고친다" on plant_status;
create policy "공장은 자기 출하현황을 고친다" on plant_status for all to authenticated
  using (plant_id in (select id from plants where company_id = my_company_id()))
  with check (plant_id in (select id from plants where company_id = my_company_id()));

-- 차량 — 공장은 자기 차량을 관리하고, 기사는 비어 있는 차량을 자기 앞으로 가져간다
drop policy if exists "공장은 자기 차량을 고친다" on trucks;
create policy "공장은 자기 차량을 고친다" on trucks for update to authenticated
  using (plant_id in (select id from plants where company_id = my_company_id()))
  with check (plant_id in (select id from plants where company_id = my_company_id()));

drop policy if exists "기사는 빈 차량을 배정받는다" on trucks;
create policy "기사는 빈 차량을 배정받는다" on trucks for update to authenticated
  using (my_role() = 'driver' and (driver_id is null or driver_id = auth.uid()))
  with check (driver_id is null or driver_id = auth.uid());

-- 즐겨찾기는 그 현장을 가진 회사만
drop policy if exists "현장은 자기 즐겨찾기를 쓴다" on favorite_mixes;
create policy "현장은 자기 즐겨찾기를 쓴다" on favorite_mixes for all to authenticated
  using (site_id in (select id from sites where company_id = my_company_id()))
  with check (site_id in (select id from sites where company_id = my_company_id()));

-- 주문 — 현장 회사(보낸 쪽)와 공장 회사(받은 쪽)만
drop policy if exists "주문은 양쪽 당사자만 본다" on orders;
create policy "주문은 양쪽 당사자만 본다" on orders for select to authenticated using (
  site_id in (select id from sites where company_id = my_company_id())
  or plant_id in (select id from plants where company_id = my_company_id())
);

drop policy if exists "현장만 주문을 만든다" on orders;
create policy "현장만 주문을 만든다" on orders for insert to authenticated with check (
  my_role() = 'site' and site_id in (select id from sites where company_id = my_company_id())
);

drop policy if exists "양쪽 당사자가 주문 상태를 바꾼다" on orders;
create policy "양쪽 당사자가 주문 상태를 바꾼다" on orders for update to authenticated using (
  site_id in (select id from sites where company_id = my_company_id())
  or plant_id in (select id from plants where company_id = my_company_id())
);

-- 배분 계획 — 그 현장 회사만
drop policy if exists "현장은 자기 배분 계획을 쓴다" on allocation_plans;
create policy "현장은 자기 배분 계획을 쓴다" on allocation_plans for all to authenticated
  using (site_id in (select id from sites where company_id = my_company_id()))
  with check (site_id in (select id from sites where company_id = my_company_id()));

-- 배분 항목 — 현장은 만들고, 배정된 공장도 자기 시각표를 본다
drop policy if exists "배분 항목은 계획을 따라간다" on plan_items;
create policy "배분 항목은 계획을 따라간다" on plan_items for select to authenticated using (
  plan_id in (
    select id from allocation_plans
    where site_id in (select id from sites where company_id = my_company_id())
  )
  or plant_id in (select id from plants where company_id = my_company_id())
);

drop policy if exists "현장이 배분 항목을 만든다" on plan_items;
create policy "현장이 배분 항목을 만든다" on plan_items for insert to authenticated with check (
  plan_id in (
    select id from allocation_plans
    where site_id in (select id from sites where company_id = my_company_id())
  )
);

-- 배송 — 주문 당사자 + 그 차의 기사
drop policy if exists "배송은 당사자와 기사가 본다" on deliveries;
create policy "배송은 당사자와 기사가 본다" on deliveries for select to authenticated using (
  order_id in (
    select id from orders
    where site_id in (select id from sites where company_id = my_company_id())
       or plant_id in (select id from plants where company_id = my_company_id())
  )
  or truck_id in (select id from trucks where driver_id = auth.uid())
);

drop policy if exists "공장이 배차한다" on deliveries;
create policy "공장이 배차한다" on deliveries for insert to authenticated with check (
  order_id in (
    select id from orders
    where plant_id in (select id from plants where company_id = my_company_id())
  )
);

drop policy if exists "당사자와 기사가 배송을 고친다" on deliveries;
create policy "당사자와 기사가 배송을 고친다" on deliveries for update to authenticated using (
  order_id in (
    select id from orders
    where site_id in (select id from sites where company_id = my_company_id())
       or plant_id in (select id from plants where company_id = my_company_id())
  )
  or truck_id in (select id from trucks where driver_id = auth.uid())
);

-- GPS — 기사는 자기 배송에만 쓰고, 당사자는 읽기만
drop policy if exists "기사만 자기 위치를 올린다" on truck_locations;
create policy "기사만 자기 위치를 올린다" on truck_locations for insert to authenticated with check (
  delivery_id in (
    select d.id from deliveries d
    join trucks t on t.id = d.truck_id
    where t.driver_id = auth.uid()
  )
);

drop policy if exists "위치는 당사자가 본다" on truck_locations;
create policy "위치는 당사자가 본다" on truck_locations for select to authenticated using (
  delivery_id in (
    select d.id from deliveries d
    join orders o on o.id = d.order_id
    where o.site_id in (select id from sites where company_id = my_company_id())
       or o.plant_id in (select id from plants where company_id = my_company_id())
  )
  or delivery_id in (
    select d.id from deliveries d
    join trucks t on t.id = d.truck_id
    where t.driver_id = auth.uid()
  )
);
