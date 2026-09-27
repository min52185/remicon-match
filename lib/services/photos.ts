'use client';

/**
 * 사진 올리기 — 기사 얼굴, 납품서(송장).
 *
 * 휴대폰 사진은 3~5MB 다. 그대로 올리면 현장에서 느리고, 기사 데이터도 쓴다.
 * 브라우저에서 먼저 줄인 다음 올린다. 크기는 쓰임에 맞춘다.
 *   얼굴    작아도 된다 — 현장에서 "이 기사가 맞나" 확인하는 용도
 *   납품서  글씨가 읽혀야 한다 — 호칭강도·물량·시각이 증빙이다
 *
 * 저장 위치는 lib/store 와 같은 규칙을 따른다. Supabase 키가 있으면 Storage,
 * 없으면 브라우저 안에만 둔다. 조원이 키 없이 화면을 확인할 수 있어야 한다.
 *
 * ⚠ 얼굴 사진은 개인정보다 (지시서 11장). 동의를 받고, 목적(현장 본인 확인) 안에서만
 *   쓰고, 기사가 언제든 지울 수 있어야 한다. 버킷은 비공개이고, 보는 사람마다
 *   짧게 사는 서명 URL 을 새로 발급한다 — 주소를 알아도 남이 열 수 없다.
 */

import { getSupabase, isSupabaseConfigured } from '../supabase/client';

export type PhotoKind = 'face' | 'note';

/** [가정] 쓰임에 맞춘 최대 변 길이(px)와 JPEG 품질 */
const PRESET: Record<PhotoKind, { maxEdge: number; quality: number; bucket: string }> = {
  face: { maxEdge: 480, quality: 0.75, bucket: 'driver-photos' },
  note: { maxEdge: 1280, quality: 0.72, bucket: 'delivery-notes' },
};

/** [가정] 줄인 뒤에도 이보다 크면 거절한다 — 무언가 잘못된 것이다 */
const MAX_BYTES = 2 * 1024 * 1024;

/** 서명 URL 유효 시간(초). 짧게 두고 볼 때마다 새로 받는다. */
const SIGNED_TTL = 60 * 10;

/* ==========================================================================
 * 줄이기
 * ======================================================================== */

/** 사진을 지정한 최대 변 길이로 줄여 JPEG Blob 으로 돌려준다 */
export async function shrink(file: File, kind: PhotoKind): Promise<Blob> {
  const { maxEdge, quality } = PRESET[kind];

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이 브라우저에서는 사진을 줄일 수 없습니다.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  if (!blob) throw new Error('사진을 바꾸지 못했습니다.');
  if (blob.size > MAX_BYTES) throw new Error('사진이 너무 큽니다. 다시 찍어 주세요.');
  return blob;
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('사진을 읽지 못했습니다.'));
    r.readAsDataURL(blob);
  });

/* ==========================================================================
 * 브라우저 저장 (시연 모드)
 * ======================================================================== */

const LOCAL_PREFIX = 'remicon.photo.';

function localPut(path: string, dataUrl: string) {
  try {
    window.localStorage.setItem(LOCAL_PREFIX + path, dataUrl);
  } catch {
    throw new Error('브라우저 저장 공간이 모자랍니다. 오래된 사진을 지워 주세요.');
  }
}

const localGet = (path: string) => {
  try {
    return window.localStorage.getItem(LOCAL_PREFIX + path);
  } catch {
    return null;
  }
};

const localDel = (path: string) => {
  try {
    window.localStorage.removeItem(LOCAL_PREFIX + path);
  } catch {
    /* 무시 */
  }
};

/**
 * 저장소 오류를 사람이 읽을 수 있는 한 줄로.
 *
 * 사진은 SQL 만으로 끝나지 않는다 — 버킷이 있어야 하고 정책도 있어야 한다.
 * 둘 중 무엇이 빠졌는지에 따라 할 일이 다른데, 원문은 영어 코드뿐이라
 * 무엇을 고쳐야 하는지 알 수가 없다.
 */
function storageFailure(e: unknown, fallback: string): Error {
  const msg = e instanceof Error ? e.message : String(e ?? '');

  if (/bucket not found/i.test(msg)) {
    return new Error(
      `${fallback} 사진 저장소(버킷)가 아직 없습니다 — 0005_photo_storage.sql 을 실행하거나 Storage 에서 버킷을 만들어 주세요.`,
    );
  }
  if (/row-level security|new row violates|403|unauthorized/i.test(msg)) {
    return new Error(
      `${fallback} 저장소 권한이 없습니다 — 0005_photo_storage.sql 의 접근 정책이 들어갔는지 확인해 주세요.`,
    );
  }
  return new Error(msg ? `${fallback} (${msg})` : fallback);
}

/* ==========================================================================
 * 올리기 · 보기 · 지우기
 * ======================================================================== */

/**
 * 사진을 올리고 저장 경로를 돌려준다.
 * 경로만 DB 에 적고, 사진 자체는 Storage(또는 브라우저)에 둔다.
 */
export async function uploadPhoto(file: File, kind: PhotoKind, path: string): Promise<string> {
  const blob = await shrink(file, kind);

  if (!isSupabaseConfigured) {
    localPut(path, await toDataUrl(blob));
    return path;
  }

  const sb = getSupabase();
  if (!sb) throw new Error('저장소에 연결할 수 없습니다.');

  const { error } = await sb.storage
    .from(PRESET[kind].bucket)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw storageFailure(error, '사진을 올리지 못했습니다.');

  return path;
}

/**
 * 볼 수 있는 주소를 만든다.
 * 비공개 버킷이라 매번 짧게 사는 서명 URL 을 새로 받는다 — 주소를 퍼뜨려도
 * 몇 분 뒤에는 열리지 않는다.
 */
export async function photoUrl(kind: PhotoKind, path: string | null | undefined): Promise<string | null> {
  if (!path) return null;

  if (!isSupabaseConfigured) return localGet(path);

  const sb = getSupabase();
  if (!sb) return null;

  const { data, error } = await sb.storage
    .from(PRESET[kind].bucket)
    .createSignedUrl(path, SIGNED_TTL);
  if (error) return null;
  return data.signedUrl;
}

export async function deletePhoto(kind: PhotoKind, path: string): Promise<void> {
  if (!isSupabaseConfigured) {
    localDel(path);
    return;
  }
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.storage.from(PRESET[kind].bucket).remove([path]);
  if (error) throw storageFailure(error, '사진을 지우지 못했습니다.');
}

/* ==========================================================================
 * 경로 규칙
 *
 * 앞자리를 소유자 id 로 둔다. Storage 정책이 경로 첫 칸만 보고 "내 것인가"를
 * 판단할 수 있어서, 남의 사진에 덮어쓰는 것을 막기 쉽다.
 * ======================================================================== */

/** 기사 얼굴 — 한 사람당 한 장이라 덮어쓴다 */
export const facePath = (userId: string) => `${userId}/face.jpg`;

/** 납품서 — 배송 한 건당 한 장 */
export const notePath = (deliveryId: string, userId: string) => `${userId}/${deliveryId}.jpg`;
