-- ============================================================================
-- 0004 — 등록 기능 (현장 · 공장 · 기사)
--
-- 0001~0003 은 "이미 있는 현장·공장으로 주문한다" 까지였다. 실제로 쓰려면
-- 자기 현장·공장·차량을 직접 넣을 수 있어야 한다. 이 파일이 그 권한을 연다.
--
-- 여는 범위를 좁게 잡았다. 로그인한 사람이면 아무거나 만들 수 있게 두면,
-- 남의 회사에 현장을 끼워 넣거나 남의 공장 가격을 고칠 수 있다.
--   현장을 만든다   → 내 회사 것으로만, 건설사 계정만
--   공장을 만든다   → 내 회사 것으로만, 레미콘사 계정만
--   차량을 만든다   → 내 회사 공장의 차량만 (공장·기사 계정)
--
-- 실행: Supabase SQL Editor 에 전체 붙여넣고 Run.
--       이미 돌린 뒤에 다시 돌려도 안전하다.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. 열 추가
-- ---------------------------------------------------------------------------

-- 기사 얼굴 사진. 사진 자체는 Storage 에 있고 여기에는 경로만 둔다.
alter table profiles   add column if not exists photo_path text;

-- 기사가 찍은 종이 납품서(송장) 사진.
alter table deliveries add column if not exists note_photo_path text;

comment on column profiles.photo_path is '기사 얼굴 사진 경로 (driver-photos 버킷). 개인정보 — 동의 후에만 채운다.';
comment on column deliveries.note_photo_path is '종이 납품서 사진 경로 (delivery-notes 버킷)';


-- ---------------------------------------------------------------------------
-- 2. 현장 등록 — 건설사 계정이 자기 회사 현장을 만든다
-- ---------------------------------------------------------------------------

drop policy if exists "현장은 자기 회사 현장을 만든다" on sites;
create policy "현장은 자기 회사 현장을 만든다" on sites for insert to authenticated
  with check (my_role() = 'site' and company_id = my_company_id());

drop policy if exists "현장은 자기 회사 현장을 고친다" on sites;
create policy "현장은 자기 회사 현장을 고친다" on sites for update to authenticated
  using (company_id = my_company_id())
  with check (company_id = my_company_id());


-- ---------------------------------------------------------------------------
-- 3. 공장 등록 — 레미콘사 계정이 자기 회사 공장을 만든다
--
-- plant_status 는 이미 "공장은 자기 출하현황을 고친다" 정책이 for all 이라
-- insert 도 포함한다. 따로 열지 않아도 등록 직후 행을 만들 수 있다.
-- ---------------------------------------------------------------------------

drop policy if exists "레미콘사는 자기 회사 공장을 만든다" on plants;
create policy "레미콘사는 자기 회사 공장을 만든다" on plants for insert to authenticated
  with check (my_role() = 'plant' and company_id = my_company_id());

drop policy if exists "레미콘사는 자기 회사 공장을 고친다" on plants;
create policy "레미콘사는 자기 회사 공장을 고친다" on plants for update to authenticated
  using (company_id = my_company_id())
  with check (company_id = my_company_id());


-- ---------------------------------------------------------------------------
-- 4. 차량 등록 — 내 회사 공장의 차량만
--
-- 기사도 만들 수 있게 열어 둔다. 새로 들어온 차나 임차 차량은 레미콘사가
-- 등록하기 전에 기사가 먼저 현장으로 가는 일이 있다.
-- ---------------------------------------------------------------------------

drop policy if exists "내 회사 공장의 차량을 만든다" on trucks;
create policy "내 회사 공장의 차량을 만든다" on trucks for insert to authenticated
  with check (
    my_role() in ('plant', 'driver')
    and plant_id in (select id from plants where company_id = my_company_id())
    -- 남을 기사로 박아 넣지 못하게 한다
    and (driver_id is null or driver_id = auth.uid())
  );


-- ---------------------------------------------------------------------------
-- 5. 기사 이름·사진을 같은 회사 사람이 볼 수 있게
--
-- 지금까지 profiles 는 '내 것만' 이었다. 그래서 차량 목록에 기사 이름 대신
-- '배정됨' 만 떴고, 얼굴 사진도 쓸 수가 없다.
--
-- 회사 경계까지만 연다. 전화번호와 사진은 개인정보라, 같은 회사가 아니면
-- 한 줄도 읽히지 않는다.
-- ---------------------------------------------------------------------------

drop policy if exists "같은 회사 사람을 본다" on profiles;
create policy "같은 회사 사람을 본다" on profiles for select to authenticated using (
  id = auth.uid()
  or (my_company_id() is not null and company_id = my_company_id())
);

-- 위 정책이 기존 '내 프로필' 을 포함하므로 중복을 지운다
drop policy if exists "내 프로필" on profiles;


-- ---------------------------------------------------------------------------
-- 6. 사진 저장소 (Storage)
--
-- 둘 다 비공개 버킷이다. 앱은 볼 때마다 몇 분짜리 서명 주소를 새로 받는다 —
-- 주소가 새어 나가도 나중에는 열리지 않는다.
--
-- 경로 규칙: 첫 칸이 올린 사람의 auth.uid() 다.
--   driver-photos/{uid}/face.jpg
--   delivery-notes/{uid}/{delivery_id}.jpg
-- 정책이 첫 칸만 보면 "내 것인가" 를 판단할 수 있어, 남의 사진에 덮어쓰는 것을
-- 막기 쉽다.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('driver-photos',  'driver-photos',  false, 2097152, array['image/jpeg']),
  ('delivery-notes', 'delivery-notes', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

-- 올리기·고치기·지우기 — 내 폴더에서만
drop policy if exists "내 사진만 올린다" on storage.objects;
create policy "내 사진만 올린다" on storage.objects for insert to authenticated
  with check (
    bucket_id in ('driver-photos', 'delivery-notes')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "내 사진만 고친다" on storage.objects;
create policy "내 사진만 고친다" on storage.objects for update to authenticated
  using (
    bucket_id in ('driver-photos', 'delivery-notes')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "내 사진만 지운다" on storage.objects;
create policy "내 사진만 지운다" on storage.objects for delete to authenticated
  using (
    bucket_id in ('driver-photos', 'delivery-notes')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 보기 — 올린 본인, 같은 회사 사람, 그리고 그 배송을 받는 현장
--
-- 마지막 조건이 중요하다. 현장이 "지금 오는 기사가 누구인지" 를 보려면 남의
-- 회사(레미콘사) 기사의 사진을 봐야 한다. 대신 지금 나에게 배송 중인 기사로만
-- 좁힌다 — 아무 기사나 들여다볼 수는 없다.
drop policy if exists "사진은 당사자만 본다" on storage.objects;
create policy "사진은 당사자만 본다" on storage.objects for select to authenticated using (
  bucket_id in ('driver-photos', 'delivery-notes')
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (storage.foldername(name))[1] in (
      select p.id::text from profiles p where p.company_id = my_company_id()
    )
    or (storage.foldername(name))[1] in (
      select t.driver_id::text
      from deliveries d
      join trucks t on t.id = d.truck_id
      join sites s on s.id = d.site_id
      where s.company_id = my_company_id() and t.driver_id is not null
    )
  )
);


-- ---------------------------------------------------------------------------
-- 7. 확인
-- ---------------------------------------------------------------------------

select
  (select count(*) from pg_policies where tablename = 'sites')  as 현장_정책,
  (select count(*) from pg_policies where tablename = 'plants') as 공장_정책,
  (select count(*) from pg_policies where tablename = 'trucks') as 차량_정책,
  (select count(*) from storage.buckets where id in ('driver-photos', 'delivery-notes')) as 사진_버킷;
