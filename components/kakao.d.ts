/**
 * 카카오맵 JavaScript SDK 의 최소 타입.
 * 공식 @types 패키지가 없어 이 프로젝트가 실제로 쓰는 것만 적어 둔다.
 * 문서: https://apis.map.kakao.com/web/documentation/
 */

export interface KakaoLatLng {
  getLat(): number;
  getLng(): number;
}

export interface KakaoLatLngBounds {
  extend(latlng: KakaoLatLng): void;
  isEmpty(): boolean;
}

export interface KakaoMap {
  setCenter(latlng: KakaoLatLng): void;
  getCenter(): KakaoLatLng;
  /** 부드럽게 이동 — 네비 추적에 쓴다. 거리가 멀면 SDK 가 알아서 순간이동한다 */
  panTo(latlng: KakaoLatLng): void;
  setLevel(level: number, options?: { animate?: boolean }): void;
  getLevel(): number;
  setBounds(
    bounds: KakaoLatLngBounds,
    paddingTop?: number,
    paddingRight?: number,
    paddingBottom?: number,
    paddingLeft?: number,
  ): void;
  addControl(control: KakaoControl, position: number): void;
  relayout(): void;
}

/** ZoomControl 등 — 내부 구조는 쓰지 않는다 */
export type KakaoControl = object;

export interface KakaoOverlay {
  setMap(map: KakaoMap | null): void;
}

export interface KakaoCustomOverlay extends KakaoOverlay {
  setPosition(latlng: KakaoLatLng): void;
  getPosition(): KakaoLatLng;
  setZIndex(z: number): void;
}

export interface KakaoPolyline extends KakaoOverlay {
  setPath(path: KakaoLatLng[]): void;
  setOptions(options: {
    strokeWeight?: number;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeStyle?: string;
  }): void;
}

/** 지도에서 일어나는 일 중 이 프로젝트가 듣는 것 */
export type KakaoMapEvent = 'click' | 'dragstart' | 'zoom_changed';

export interface KakaoMaps {
  load(cb: () => void): void;
  LatLng: new (lat: number, lng: number) => KakaoLatLng;
  LatLngBounds: new () => KakaoLatLngBounds;
  Map: new (container: HTMLElement, options: { center: KakaoLatLng; level: number }) => KakaoMap;
  ZoomControl: new () => KakaoControl;
  ControlPosition: { TOPRIGHT: number; RIGHT: number; BOTTOMRIGHT: number };
  CustomOverlay: new (options: {
    position: KakaoLatLng;
    content: HTMLElement | string;
    map?: KakaoMap;
    yAnchor?: number;
    xAnchor?: number;
    zIndex?: number;
    clickable?: boolean;
  }) => KakaoCustomOverlay;
  Polyline: new (options: {
    path: KakaoLatLng[];
    strokeWeight?: number;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeStyle?: string;
    map?: KakaoMap;
  }) => KakaoPolyline;
  event: {
    addListener(
      target: KakaoMap,
      type: KakaoMapEvent,
      handler: (e: KakaoMouseEvent) => void,
    ): void;
    removeListener(
      target: KakaoMap,
      type: KakaoMapEvent,
      handler: (e: KakaoMouseEvent) => void,
    ): void;
  };
}

export interface KakaoMouseEvent {
  latLng?: KakaoLatLng;
}

declare global {
  interface Window {
    kakao?: { maps: KakaoMaps };
  }
}

export {};
