-- ============================================================================
-- 레미콘 매칭 플랫폼 — 초기 스키마 (지시서 4장)
--
-- 붙여넣는 곳: Supabase 대시보드 → 왼쪽 메뉴 SQL Editor → New query → 전체 붙여넣고 Run.
-- 실행 순서는 이 파일 하나면 된다. 다시 실행해도 안전하도록 IF NOT EXISTS 를 붙였다.
--
-- ⚠ RLS 를 켜지 않으면 anon 키만 있으면 누구나 모든 데이터를 읽고 쓸 수 있다.
--   이 파일 맨 아래 정책까지 반드시 같이 실행한다.
-- ============================================================================

create extension if not exists postgis;

-- ---------------------------------------------------------------------------
-- 1. 회사 · 계정
-- ---------------------------------------------------------------------------

create type company_kind as enum ('건설사', '레미콘사');
create type user_role as enum ('site', 'plant', 'driver', 'admin');

create table if not exists companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        company_kind not null,
  created_at  timestamptz not null default now()
);

-- 로그인 계정과 1:1. auth.users 가 생기면 트리거로 여기에 한 줄 만든다.
create table if not exists profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null,
  role        user_role not null,
  company_id  uuid references companies (id) on delete set null,
  phone       text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. 현장 · 공장 · 차량
-- ---------------------------------------------------------------------------

create table if not exists sites (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references companies (id) on delete cascade,
  name        text not null,
  address     text not null,
  location    geography(point, 4326) not null,
  access_note text,
  created_at  timestamptz not null default now()
);

create table if not exists plants (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid references companies (id) on delete cascade,
  name           text not null,
  address        text not null,
  location       geography(point, 4326) not null,
  phone          text,
  -- 생산 능력: { "maxStrength": {"보통":35}, "aggs":[20,25], "flow":true, "cements":[...] }
  capability     jsonb not null default '{}'::jsonb,
  fleet_size     int not null default 0,
  -- 한 현장으로 시간당 내보낼 수 있는 최대 대수 (지시서 6장 제약 ③)
  hourly_rate    int not null default 4,
  created_at     timestamptz not null default now()
);

-- 공장이 수시로 고치는 값만 따로 둔다 (자주 바뀌고 실시간 구독 대상)
create table if not exists plant_status (
  plant_id          uuid primary key references plants (id) on delete cascade,
  available_trucks  int not null default 0,
  available_volume  numeric(10, 1) not null default 0,
  is_open           boolean not null default true,
  updated_at        timestamptz not null default now()
);

create table if not exists trucks (
  id           uuid primary key default gen_random_uuid(),
  plant_id     uuid not null references plants (id) on delete cascade,
  no           int not null,
  plate_no     text not null,
  capacity_m3  numeric(5, 1) not null default 6,
  driver_id    uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (plant_id, no)
);

-- ---------------------------------------------------------------------------
-- 3. 즐겨찾기 (지시서 5장 ★)
-- ---------------------------------------------------------------------------

create table if not exists favorite_mixes (
  id                 uuid primary key default gen_random_uuid(),
  site_id            uuid not null references sites (id) on delete cascade,
  alias              text not null,
  -- { type, aggMm, strength, slumpKind, slumpMm, cement }
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
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references allocation_plans (id) on delete cascade,
  plant_id        uuid not null references plants (id) on delete cascade,
  trucks          int not null,
  travel_minutes  numeric(6, 1) not null,
  -- 배정된 회차 번호와 회차별 출하(비비기 시작) 예정 시각
  rounds          int[] not null default '{}',
  mix_start_ats   timestamptz[] not null default '{}'
);

-- ---------------------------------------------------------------------------
-- 5. 주문 · 배송
-- ---------------------------------------------------------------------------

create type order_status as enum
  ('requested', 'accepted', 'delivering', 'completed', 'rejected', 'cancelled');

create table if not exists orders (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  site_id        uuid not null references sites (id) on delete cascade,
  plant_id       uuid not null references plants (id) on delete cascade,
  spec           jsonb not null,
  volume_m3      numeric(10, 1) not null,
  pour_start_at  timestamptz not null,
  pump_rate      numeric(6, 1) not null,
  temp_c         numeric(4, 1) not null,
  status         order_status not null default 'requested',
  plan_id        uuid references allocation_plans (id) on delete set null,
  reject_reason  text,
  note           text,
  created_by     uuid references profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists orders_site_idx on orders (site_id, created_at desc);
create index if not exists orders_plant_idx on orders (plant_id, status, created_at desc);

-- 납품서 한 장 = 트럭 1회
create table if not exists deliveries (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders (id) on delete cascade,
  truck_id        uuid not null references trucks (id) on delete restrict,
  volume_m3       numeric(5, 1) not null,
  mix_start_at    timestamptz not null,
  depart_at       timestamptz not null,
  eta_initial_at  timestamptz not null,
  eta_current_at  timestamptz not null,
  arrive_at       timestamptz,
  completed_at    timestamptz,
  limit_minutes   int not null,
  travel_minutes  numeric(6, 1) not null,
  distance_km     numeric(7, 1),
  -- 추천 경로 (LineString). 지도에 그대로 그린다.
  route           geography(linestring, 4326),
  delay_reason    text,
  created_at      timestamptz not null default now()
);

create index if not exists deliveries_order_idx on deliveries (order_id, mix_start_at);

-- GPS 기록. 지시서 4장: 버리지 않는다 — 지연 예측 학습 데이터가 된다.
create table if not exists truck_locations (
  id           bigserial primary key,
  delivery_id  uuid not null references deliveries (id) on delete cascade,
  lat          double precision not null,
  lng          double precision not null,
  speed_kmh    numeric(6, 1),
  heading      numeric(6, 1),
  recorded_at  timestamptz not null default now()
);

create index if not exists truck_locations_delivery_idx
  on truck_locations (delivery_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- 6. 실시간 구독 (Realtime)
--   현장 화면이 차량 위치·주문 상태 변경을 즉시 받도록 publication 에 넣는다.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table deliveries;
alter publication supabase_realtime add table truck_locations;
alter publication supabase_realtime add table plant_status;

-- ---------------------------------------------------------------------------
-- 7. 권한 (RLS) — 지시서 4장
--   현장 계정은 자기 현장 주문만, 공장 계정은 자기 공장으로 온 주문만,
--   기사는 자기 배송만 읽고 쓴다.
-- ---------------------------------------------------------------------------

alter table companies       enable row level security;
alter table profiles        enable row level security;
alter table sites           enable row level security;
alter table plants          enable row level security;
alter table plant_status    enable row level security;
alter table trucks          enable row level security;
alter table favorite_mixes  enable row level security;
alter table allocation_plans enable row level security;
alter table plan_items      enable row level security;
alter table orders          enable row level security;
alter table deliveries      enable row level security;
alter table truck_locations enable row level security;

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

-- 공장·현장 목록은 로그인한 사람이면 볼 수 있다 (주문하려면 공장을 찾아야 하므로)
create policy "로그인 사용자는 공장을 본다"   on plants       for select to authenticated using (true);
create policy "로그인 사용자는 출하현황을 본다" on plant_status for select to authenticated using (true);
create policy "로그인 사용자는 회사를 본다"   on companies    for select to authenticated using (true);
create policy "로그인 사용자는 현장을 본다"   on sites        for select to authenticated using (true);
create policy "로그인 사용자는 차량을 본다"   on trucks       for select to authenticated using (true);

create policy "내 프로필" on profiles
  for select to authenticated using (id = auth.uid());

-- 공장 계정만 자기 공장 출하현황을 고친다
create policy "공장은 자기 출하현황을 고친다" on plant_status
  for all to authenticated
  using (plant_id in (select id from plants where company_id = my_company_id()))
  with check (plant_id in (select id from plants where company_id = my_company_id()));

-- 즐겨찾기는 그 현장을 가진 회사만
create policy "현장은 자기 즐겨찾기를 쓴다" on favorite_mixes
  for all to authenticated
  using (site_id in (select id from sites where company_id = my_company_id()))
  with check (site_id in (select id from sites where company_id = my_company_id()));

-- 주문: 현장 회사(보낸 쪽) 또는 공장 회사(받은 쪽)만
create policy "주문은 양쪽 당사자만 본다" on orders
  for select to authenticated using (
    site_id  in (select id from sites  where company_id = my_company_id())
    or plant_id in (select id from plants where company_id = my_company_id())
  );

create policy "현장만 주문을 만든다" on orders
  for insert to authenticated with check (
    my_role() = 'site'
    and site_id in (select id from sites where company_id = my_company_id())
  );

create policy "양쪽 당사자가 주문 상태를 바꾼다" on orders
  for update to authenticated using (
    site_id  in (select id from sites  where company_id = my_company_id())
    or plant_id in (select id from plants where company_id = my_company_id())
  );

-- 배분 계획은 그 현장 회사만
create policy "현장은 자기 배분 계획을 쓴다" on allocation_plans
  for all to authenticated
  using (site_id in (select id from sites where company_id = my_company_id()))
  with check (site_id in (select id from sites where company_id = my_company_id()));

create policy "배분 항목은 계획을 따라간다" on plan_items
  for select to authenticated using (
    plan_id in (
      select id from allocation_plans
      where site_id in (select id from sites where company_id = my_company_id())
    )
    -- 공장도 자기에게 배정된 회차 시각표를 봐야 한다
    or plant_id in (select id from plants where company_id = my_company_id())
  );

-- 배송: 주문 당사자 + 그 차의 기사
create policy "배송은 당사자와 기사가 본다" on deliveries
  for select to authenticated using (
    order_id in (
      select id from orders
      where site_id  in (select id from sites  where company_id = my_company_id())
         or plant_id in (select id from plants where company_id = my_company_id())
    )
    or truck_id in (select id from trucks where driver_id = auth.uid())
  );

create policy "공장이 배차한다" on deliveries
  for insert to authenticated with check (
    order_id in (
      select id from orders
      where plant_id in (select id from plants where company_id = my_company_id())
    )
  );

create policy "당사자와 기사가 배송을 고친다" on deliveries
  for update to authenticated using (
    order_id in (
      select id from orders
      where site_id  in (select id from sites  where company_id = my_company_id())
         or plant_id in (select id from plants where company_id = my_company_id())
    )
    or truck_id in (select id from trucks where driver_id = auth.uid())
  );

-- GPS: 기사는 자기 배송에만 쓰고, 당사자는 읽기만
create policy "기사만 자기 위치를 올린다" on truck_locations
  for insert to authenticated with check (
    delivery_id in (
      select d.id from deliveries d
      join trucks t on t.id = d.truck_id
      where t.driver_id = auth.uid()
    )
  );

create policy "위치는 당사자가 본다" on truck_locations
  for select to authenticated using (
    delivery_id in (
      select d.id from deliveries d
      join orders o on o.id = d.order_id
      where o.site_id  in (select id from sites  where company_id = my_company_id())
         or o.plant_id in (select id from plants where company_id = my_company_id())
    )
  );
