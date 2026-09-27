-- ============================================================================
-- 0005 — 사진 저장소 (기사 얼굴 · 납품서)
--
-- 0004 에서 따로 뺀 이유: Supabase 프로젝트에 따라 SQL Editor 가 storage.objects
-- 에 정책을 만들 권한이 없다. 이 테이블의 소유자는 supabase_storage_admin 이라,
-- 막혀 있으면 "42501 must be owner of table objects" 가 난다.
--
-- SQL Editor 는 스크립트 전체를 한 트랜잭션으로 돌린다. 한 파일에 두면 그 한
-- 줄 때문에 앞의 alter table 까지 전부 되돌려진다 — 0004 가 하나도 안 들어간
-- 것처럼 보이는 이유가 이것이다.
--
-- 그래서 이 파일은 실패해도 멈추지 않는다. 막힌 부분은 건너뛰고 맨 아래에
-- "무엇이 안 됐고 대신 무엇을 하면 되는지" 를 찍어 준다.
--
-- 버킷 둘 다 비공개다. 앱은 볼 때마다 10분짜리 서명 주소를 새로 받는다 —
-- 주소가 새어 나가도 나중에는 열리지 않는다.
--
-- 경로 규칙: 첫 칸이 올린 사람의 auth.uid() 다.
--   driver-photos/{uid}/face.jpg
--   delivery-notes/{uid}/{delivery_id}.jpg
-- 정책이 첫 칸만 보면 "내 것인가" 를 판단할 수 있어, 남의 사진에 덮어쓰는 것을
-- 막기 쉽다.
--
-- 실행: Supabase SQL Editor 에 전체 붙여넣고 Run. 다시 돌려도 안전하다.
-- ============================================================================

do $$
declare
  bucket_ok boolean := false;
  policy_ok boolean := false;
begin

  -- -------------------------------------------------------------------------
  -- 1. 버킷 두 개
  -- -------------------------------------------------------------------------
  begin
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values
      ('driver-photos',  'driver-photos',  false, 2097152, array['image/jpeg']),
      ('delivery-notes', 'delivery-notes', false, 2097152, array['image/jpeg'])
    on conflict (id) do nothing;
    bucket_ok := true;
  exception when insufficient_privilege or undefined_table then
    bucket_ok := false;
  end;

  -- -------------------------------------------------------------------------
  -- 2. 정책 — 올리기·고치기·지우기는 내 폴더에서만
  --
  -- 보기는 세 갈래로 연다. 마지막 조건이 중요하다: 현장이 "지금 오는 기사가
  -- 누구인지" 를 보려면 남의 회사(레미콘사) 기사의 사진을 봐야 한다. 대신
  -- 지금 나에게 배송 중인 기사로만 좁힌다 — 아무 기사나 들여다볼 수는 없다.
  -- -------------------------------------------------------------------------
  begin
    execute $p$ drop policy if exists "내 사진만 올린다" on storage.objects $p$;
    execute $p$
      create policy "내 사진만 올린다" on storage.objects for insert to authenticated
        with check (
          bucket_id in ('driver-photos', 'delivery-notes')
          and (storage.foldername(name))[1] = auth.uid()::text
        )
    $p$;

    execute $p$ drop policy if exists "내 사진만 고친다" on storage.objects $p$;
    execute $p$
      create policy "내 사진만 고친다" on storage.objects for update to authenticated
        using (
          bucket_id in ('driver-photos', 'delivery-notes')
          and (storage.foldername(name))[1] = auth.uid()::text
        )
    $p$;

    execute $p$ drop policy if exists "내 사진만 지운다" on storage.objects $p$;
    execute $p$
      create policy "내 사진만 지운다" on storage.objects for delete to authenticated
        using (
          bucket_id in ('driver-photos', 'delivery-notes')
          and (storage.foldername(name))[1] = auth.uid()::text
        )
    $p$;

    execute $p$ drop policy if exists "사진은 당사자만 본다" on storage.objects $p$;
    execute $p$
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
      )
    $p$;

    policy_ok := true;
  exception when insufficient_privilege or undefined_table then
    policy_ok := false;
  end;

  -- -------------------------------------------------------------------------
  -- 3. 결과 안내
  -- -------------------------------------------------------------------------
  raise notice '';
  raise notice '================ 사진 저장소 설정 결과 ================';

  if bucket_ok then
    raise notice '  버킷 2개 : 성공';
  else
    raise notice '  버킷 2개 : 실패 — 권한이 막혀 있습니다.';
    raise notice '             대시보드 왼쪽 [Storage] → [New bucket] 에서 손으로 만드세요.';
    raise notice '               이름 driver-photos   · Public 끄기';
    raise notice '               이름 delivery-notes  · Public 끄기';
  end if;

  if policy_ok then
    raise notice '  접근 정책 : 성공';
  else
    raise notice '  접근 정책 : 실패 — storage.objects 소유자가 아니라 만들 수 없습니다.';
    raise notice '             대시보드 [Storage] → 버킷 선택 → [Policies] 에서 만드세요.';
    raise notice '             자세한 순서는 README 의 "사진 저장소" 절에 적어 뒀습니다.';
  end if;

  raise notice '=======================================================';
  raise notice '';
end $$;


-- 확인 — 버킷이 만들어졌는지
select id, public, file_size_limit
from storage.buckets
where id in ('driver-photos', 'delivery-notes');
