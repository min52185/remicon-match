/**
 * 시연용 가상 데이터 — 전부 지어낸 것이다.
 * 실제 공장 위치·출하 능력·가용 차량은 공개 데이터가 아니므로 실제 회사명·로고는 쓰지 않는다 (지시서 11장).
 * 지역은 경기 남부로 맞췄다.
 *
 * 지시서 2단계에서 이 데이터를 그대로 Supabase seed 로 옮긴다 (supabase/migrations/0002_seed.sql).
 */

import { C1, C2, C3, C4, C5, FLY2, POZZ, SLAG2, SLAG3, TRUCK_CAPACITY_M3, WHITE } from '../rules';
import type { ConcreteType, Plant, PlantCapability, Site, Truck } from '../types';

export const SEED_SITES: Site[] = [
  {
    id: 's1',
    name: '서천동 근린생활시설 신축현장',
    address: '경기 용인시 기흥구 서천동',
    lat: 37.2372,
    lng: 127.0772,
    accessNote: '동측 가설게이트로 진입. 펌프카 북쪽 배치.',
  },
  {
    id: 's2',
    name: '광교 업무시설 신축공사',
    address: '경기 수원시 영통구 이의동',
    lat: 37.289,
    lng: 127.048,
    accessNote: '지하 진입로 경사 급함. 저녁 6시 이후 소음 민원 주의.',
  },
  {
    id: 's3',
    name: '동탄2 물류센터 신축공사',
    address: '경기 화성시 동탄',
    lat: 37.188,
    lng: 127.106,
    accessNote: '대형차 진입 가능. 현장 내 세척장 있음.',
  },
];

const cap = (
  maxStrength: Partial<Record<ConcreteType, number>>,
  aggs: number[],
  flow: boolean,
  cements: string[],
): PlantCapability => ({ maxStrength, aggs, flow, cements });

interface PlantSeed {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  fleetSize: number;
  availableTrucks: number;
  availableVolume: number;
  isOpen: boolean;
  cap: PlantCapability;
}

const seed = (
  id: string,
  name: string,
  address: string,
  lat: number,
  lng: number,
  fleetSize: number,
  availableTrucks: number,
  availableVolume: number,
  isOpen: boolean,
  capability: PlantCapability,
): PlantSeed => ({
  id,
  name,
  address,
  lat,
  lng,
  fleetSize,
  availableTrucks,
  availableVolume,
  isOpen,
  cap: capability,
});

const SEED: PlantSeed[] = [
  seed('p01', '가온레미콘 동탄공장', '경기 화성시 동탄면', 37.172, 127.1268, 14, 8, 240, true,
    cap({ 보통: 35, 고강도: 50 }, [20, 25, 40], true, [C1, C3, SLAG2, FLY2])),
  seed('p02', '누리레미콘 용인공장', '경기 용인시 처인구', 37.241, 127.178, 12, 5, 150, true,
    cap({ 보통: 30 }, [20, 25, 40], false, [C1, SLAG2])),
  // 차량이 전부 출하 중인 공장
  seed('p03', '다온레미콘 수원공장', '경기 수원시 권선구', 37.265, 126.97, 10, 0, 0, true,
    cap({ 보통: 35, 경량: 30 }, [20, 25], false, [C1, SLAG2, FLY2])),
  // 물량이 모자란 공장
  seed('p04', '한결레미콘 오산공장', '경기 오산시', 37.15, 127.045, 9, 3, 36, true,
    cap({ 보통: 30, 포장: 4.5 }, [25, 40], false, [C1, SLAG2])),
  seed('p05', '보람레미콘 의왕공장', '경기 의왕시', 37.345, 126.975, 16, 10, 320, true,
    cap({ 보통: 35, 고강도: 60 }, [20, 25, 40], true, [C1, C2, C3, C4, SLAG2, SLAG3, FLY2])),
  // 출하를 중지한 공장
  seed('p06', '새봄레미콘 화성공장', '경기 화성시 봉담읍', 37.215, 126.93, 8, 4, 90, false,
    cap({ 보통: 30 }, [25], false, [C1])),
  seed('p07', '미소레미콘 성남공장', '경기 성남시 수정구', 37.43, 127.16, 15, 9, 300, true,
    cap({ 보통: 35, 경량: 40, 고강도: 50 }, [20, 25], true, [C1, C3, SLAG2, WHITE])),
  seed('p08', '참빛레미콘 평택공장', '경기 평택시 진위면', 37.07, 127.06, 11, 6, 180, true,
    cap({ 보통: 35, 포장: 4.5 }, [20, 25, 40], false, [C1, C2, SLAG2])),
  seed('p09', '푸른레미콘 안산공장', '경기 안산시 단원구', 37.31, 126.81, 13, 7, 200, true,
    cap({ 보통: 35 }, [20, 25], true, [C1, C5, SLAG2, FLY2])),
  seed('p10', '온새미레미콘 광주공장', '경기 광주시', 37.41, 127.27, 10, 4, 120, true,
    cap({ 보통: 30 }, [25], false, [C1, SLAG2])),
  seed('p11', '하늘레미콘 안성공장', '경기 안성시', 37.0, 127.29, 9, 5, 150, true,
    cap({ 보통: 30 }, [20, 25, 40], false, [C1])),
  seed('p12', '한울레미콘 이천공장', '경기 이천시', 37.26, 127.47, 12, 6, 200, true,
    cap({ 보통: 35, 경량: 35 }, [20, 25], false, [C1, SLAG2, POZZ])),
];

/**
 * [가정] 한 현장으로 시간당 내보낼 수 있는 대수.
 * 공장은 여러 현장에 동시에 납품하므로 보유 대수를 전부 한 현장에 쏟지 못한다.
 * 보유 대수의 1/3 정도로 두고, 실제 운행 기록이 쌓이면 고친다.
 */
const hourlyRateOf = (fleetSize: number) => Math.max(2, Math.round(fleetSize / 3));

export const SEED_PLANTS: Plant[] = SEED.map((p) => ({
  ...p,
  phone: `031-000-10${p.id.slice(1)}`,
  hourlyRate: hourlyRateOf(p.fleetSize),
}));

const DRIVER_SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황'];

/** 공장 보유 차량 — 보유 대수에서 결정적으로 만든다 (매번 같은 차량번호가 나오도록) */
export function trucksOf(plant: Plant): Truck[] {
  const k = parseInt(plant.id.slice(1), 10) || 1;
  return Array.from({ length: plant.fleetSize }, (_, i) => ({
    id: `${plant.id}-T${i + 1}`,
    plantId: plant.id,
    no: i + 1,
    plateNo: `경기 ${80 + ((k * 7 + i * 3) % 20)}바 ${1000 + ((k * 977 + i * 1319) % 9000)}`,
    driver: `${DRIVER_SURNAMES[(k + i * 5) % DRIVER_SURNAMES.length]}○○`,
    capacityM3: TRUCK_CAPACITY_M3,
  }));
}

export const SEED_TRUCKS: Truck[] = SEED_PLANTS.flatMap(trucksOf);
