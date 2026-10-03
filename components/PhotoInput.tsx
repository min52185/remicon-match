'use client';

/**
 * 사진 한 장 올리기 — 기사 얼굴, 납품서.
 *
 * 휴대폰에서는 카메라가 바로 열려야 한다(capture). 올린 뒤에는 무엇이 올라갔는지
 * 보여 준다 — 흔들렸거나 잘렸으면 다시 찍어야 하는데, 안 보여 주면 알 수가 없다.
 *
 * 사진은 올리는 즉시 저장된다. '저장' 버튼을 따로 두지 않는 이유는, 현장에서
 * 장갑 낀 채로 한 단계라도 줄이는 편이 낫고 사진은 되돌릴 일이 거의 없어서다.
 * 잘못 찍었으면 다시 찍거나 지우면 된다.
 */

import { useEffect, useRef, useState } from 'react';
import { Tag } from './ui';
import { deletePhoto, photoUrl, uploadPhoto, type PhotoKind } from '@/lib/services/photos';

export default function PhotoInput({
  kind,
  path,
  savedPath,
  label,
  hint,
  onSaved,
  onRemoved,
  height = 180,
  disabled,
  placeholderSrc,
}: {
  kind: PhotoKind;
  /** 올릴 때 쓸 경로 */
  path: string;
  /** 이미 올라가 있으면 그 경로 — 없으면 빈 상태로 시작 */
  savedPath?: string | null;
  label: string;
  hint?: string;
  onSaved: (path: string) => void | Promise<void>;
  onRemoved?: () => void | Promise<void>;
  height?: number;
  disabled?: boolean;
  /** 올린 사진이 없을 때 대신 보여 줄 그림 */
  placeholderSrc?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 서명 URL 은 몇 분 뒤 만료된다 — 경로가 바뀔 때마다 새로 받는다
  useEffect(() => {
    let alive = true;
    if (!savedPath) {
      setUrl(null);
      return;
    }
    photoUrl(kind, savedPath).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [kind, savedPath]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await uploadPhoto(file, kind, path);
      await onSaved(saved);
      setUrl(await photoUrl(kind, saved));
    } catch (e) {
      setError(e instanceof Error ? e.message : '사진을 올리지 못했습니다.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove() {
    if (!savedPath) return;
    setBusy(true);
    setError(null);
    try {
      await deletePhoto(kind, savedPath);
      await onRemoved?.();
      setUrl(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '사진을 지우지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <span className="label">{label}</span>

      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          background: 'var(--color-paper)',
          border: '1px dashed var(--color-line-strong)',
          borderRadius: 'var(--radius-sharp)',
          marginBottom: 8,
        }}
      >
        {url ? (
          // 사용자가 올린 사진이라 크기를 알 수 없다 — next/image 대신 img 를 쓴다
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={label}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        ) : placeholderSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={placeholderSrc} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        ) : (
          <span style={{ fontSize: '0.84rem', color: 'var(--color-concrete-mid)' }}>
            {busy ? '올리는 중…' : '아직 사진이 없습니다'}
          </span>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        // 휴대폰에서는 카메라가 바로 열린다
        capture="environment"
        hidden
        onChange={(e) => void pick(e.target.files?.[0])}
      />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          style={{ flex: 1 }}
          disabled={busy || disabled}
          onClick={() => fileRef.current?.click()}
        >
          {url ? '다시 찍기' : '사진 찍기 · 고르기'}
        </button>
        {url && onRemoved && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => void remove()}
          >
            지우기
          </button>
        )}
      </div>

      {url && (
        <span style={{ display: 'inline-block', marginTop: 8 }}>
          <Tag tone="ok">저장됨</Tag>
        </span>
      )}

      {error && (
        <p style={{ fontSize: '0.82rem', color: 'var(--color-bad)', margin: '8px 0 0' }}>{error}</p>
      )}
      {hint && (
        <p style={{ fontSize: '0.78rem', color: 'var(--color-concrete-mid)', margin: '8px 0 0' }}>
          {hint}
        </p>
      )}
    </div>
  );
}
