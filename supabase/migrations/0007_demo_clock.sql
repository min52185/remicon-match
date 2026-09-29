-- ============================================================================
-- 0007 — 시연 시계를 기기끼리 공유
--
-- 시계가 브라우저 localStorage 에만 있었다. storage 이벤트는 같은 브라우저의
-- 탭끼리만 통하므로, 노트북·휴대폰 두 대로 시연하면 각자 다른 시계를 본다.
-- 한쪽만 ×60 으로 올리면 1분 만에 1시간이 벌어진다.
--
-- 표시만의 문제가 아니다. 공장이 누른 '출하 지시'의 비비기 시작 시각은 공장
-- 기기 시계로 찍히고, 현장이 보는 '타설 기한 남은 시간'은 현장 기기 시계로
-- 계산된다. 시계가 갈라지면 기한이 이미 지난 것처럼 보인다.
--
-- 한 줄짜리 표를 두고 Realtime 으로 공유한다. 어느 기기에서 배속을 바꾸든
-- 세 대가 같이 움직인다.
--
-- 실행: Supabase SQL Editor 에 붙여넣고 Run. 다시 돌려도 안전하다.
-- ============================================================================

create table if not exists demo_clock (
  -- 시계는 하나뿐이다. id 를 1 로 못박아 두 줄이 생기지 않게 한다.
  id         int primary key default 1,
  -- 배속을 바꾼 기기의 실제 시각
  base_real  timestamptz not null default now(),
  -- 그때의 시연 시각
  base_sim   timestamptz not null default now(),
  speed      numeric(6, 2) not null default 1,
  updated_at timestamptz not null default now(),
  constraint demo_clock_single_row check (id = 1)
);

comment on table demo_clock is '시연 시계 — 기기끼리 공유. 실서비스에서는 speed 를 1 로 둔다.';

-- 첫 줄 만들기 (이미 있으면 그대로 둔다)
insert into demo_clock (id) values (1) on conflict (id) do nothing;

alter table demo_clock enable row level security;

-- 시연 도구라 로그인한 사람이면 누구나 보고 바꾼다.
-- 개인정보가 아니고, 발표 중에 어느 기기에서든 배속을 눌러야 한다.
drop policy if exists "로그인 사용자는 시연 시계를 본다" on demo_clock;
create policy "로그인 사용자는 시연 시계를 본다" on demo_clock
  for select to authenticated using (true);

drop policy if exists "로그인 사용자는 시연 시계를 바꾼다" on demo_clock;
create policy "로그인 사용자는 시연 시계를 바꾼다" on demo_clock
  for update to authenticated using (true) with check (true);

drop policy if exists "시연 시계 첫 줄 만들기" on demo_clock;
create policy "시연 시계 첫 줄 만들기" on demo_clock
  for insert to authenticated with check (id = 1);

-- Realtime 으로 내보낸다. 이게 없으면 다른 기기가 변경을 못 받는다.
do $$ begin
  alter publication supabase_realtime add table demo_clock;
exception
  when duplicate_object then null;
  when undefined_object then
    raise notice '  supabase_realtime 발행이 없습니다. 대시보드 Database > Replication 에서 demo_clock 을 켜 주세요.';
end $$;


-- 확인 — 1 이 나오면 성공
select count(*) as 시계_줄, (select speed from demo_clock where id = 1) as 현재_배속
from demo_clock;
