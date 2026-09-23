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
  setLevel(level: number): void;
  getLevel(): number;
  setBounds(bounds: KakaoLatLngBounds, paddingTop?: number, paddingRight?: number, paddingBottom?: number, paddingLeft?: number): void;
  relayout(): void;
}

export interface KakaoOverlay {
  setMap(map: KakaoMap | null): void;
  setPosition?(latlng: KakaoLatLng): void;
}

export interface KakaoMaps {
  load(cb: () => void): void;
  LatLng: new (lat: number, lng: number) => KakaoLatLng;
  LatLngBounds: new () => KakaoLatLngBounds;
  Map: new (container: HTMLElement, options: { center: KakaoLatLng; level: number }) => KakaoMap;
  CustomOverlay: new (options: {
    position: KakaoLatLng;
    content: HTMLElement | string;
    map?: KakaoMap;
    yAnchor?: number;
    xAnchor?: number;
    zIndex?: number;
    clickable?: boolean;
  }) => KakaoOverlay;
  Polyline: new (options: {
    path: KakaoLatLng[];
    strokeWeight?: number;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeStyle?: string;
    map?: KakaoMap;
  }) => KakaoOverlay;
}

declare global {
  interface Window {
    kakao?: { maps: KakaoMaps };
  }
}

export {};
