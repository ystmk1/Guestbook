/* =====================================================================
   전시 운영 중에 만질 만한 값들을 여기 한 곳에 모아둔다.
   ===================================================================== */

export interface Entry {
  /** Supabase uuid. 아직 서버에 안 올라간 글은 'local:...' */
  id: string;
  body: string;
  nickname: string | null;
  /** epoch ms */
  createdAt: number;
  /** 서버 반영 대기 중 */
  pending?: boolean;
}

export const PALETTE = {
  paper: 0xf2f0e9,
  ink: 0x23261f,
  ui: 0x8d8a7b,
  moss: 0x5e8425,
  coral: 0xc0524c,
  line: 0x968e7c,
  cloud: 0x564e40,
} as const;

export const TUNING = {
  /** 기본 자전 속도 (rad/s) — 원본 0.058 */
  spin: 0.058,
  /** 호버 시 회전이 멈추기까지 (초) */
  spinStopTime: 0.42,
  /** 호버가 풀린 뒤 회전이 다시 붙기까지 (초) */
  spinResumeTime: 1.1,
  /** 노드 히트 반경 (px) — 넉넉하게 잡아야 관람객이 안 헤맨다 */
  hitRadius: 30,
  /** 포커스 진입/이탈 속도 */
  focusIn: 3.4,
  focusOut: 2.2,
  /** 포커스 시 카메라가 노드에 얼마나 다가가는가 (월드 유닛) */
  focusDistance: 5.6,
  /** 기본 카메라 거리 */
  cameraDistance: 21.5,
  /** 주변에 동시에 띄우는 조용한 라벨 개수 */
  ambientLabels: 14,
  /** 안내문이 사라지기까지 (ms) */
  hintTimeout: 14000,
  /** 서버와 전체 재동기화 주기 (ms) — 숨김 처리 전파용 */
  resyncInterval: 60_000,
  /**
   * 서버에서 한 번에 불러오는 기록 수 = 화면에 띄우는 양.
   * 구조의 가지 끝은 364개다. 그보다 많아지면 오래된 것부터
   * 자리를 내주고 최근 364개가 화면을 채운다 (기록 자체는 남는다).
   */
  fetchLimit: 400,

  /**
   * localStorage 에 보관하는 기록 수.
   * 로컬 모드에서는 이것이 전시의 유일한 원본이므로 화면 표시 한도와
   * 분리해서 넉넉히 잡는다. 5000건이면 약 600KB — 브라우저 한도(5MB) 안쪽.
   */
  storeLimit: 5000,
} as const;

export const LIMITS = {
  bodyMax: 140,
  nickMax: 16,
  maxLines: 3,
} as const;

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

/**
 * Supabase 는 "있으면 쓰고 없으면 안 쓴다".
 * 환경변수를 안 넣으면 이 노트북의 localStorage 에만 저장하는 로컬 모드로 돈다.
 * 나중에 Vercel 에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 두 개만 넣고
 * 재배포하면 코드 수정 없이 그대로 서버 저장으로 전환된다.
 */
export const HAS_SUPABASE = SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

export const HUD_TITLE = (import.meta.env.VITE_EXHIBITION_TITLE ?? 'SYMPOIESIS').trim();

/**
 * 로컬 모드에서 관리자 숨김에 쓰는 PIN.
 * 서버 모드에서는 이 값을 쓰지 않고 Supabase 함수가 직접 검증한다
 * (그쪽 PIN 은 schema.sql 의 admin_config 에 해시로 들어간다).
 * 로컬 모드의 상대는 "지나가다 키를 눌러보는 관람객"이므로 이 정도면 충분하다.
 */
export const LOCAL_ADMIN_PIN = (import.meta.env.VITE_ADMIN_PIN ?? '1234').trim();

const params = new URLSearchParams(
  typeof location !== 'undefined' ? location.search : '',
);

/** ?demo=1 로 열었을 때만 예시 문장을 깐다. 전시 화면은 빈 상태로 시작한다. */
export const DEMO_MODE = params.get('demo') === '1';

/** ?kiosk=1 — 안내문·커서 등 전시용 정리 */
export const KIOSK_MODE = params.get('kiosk') === '1';

/** 예시 문장 (데모 전용) */
export const DEMO_SEED = [
  '공생이라는 말이 이렇게 축축한 건 줄 몰랐다',
  '키보드 소리가 제일 좋았어요',
  '혼자 오길 잘했다',
  '안개가 손에 닿을 줄 알았는데',
  '이끼가 진짜인지 계속 확인했다',
  '벽돌 사이에 초록색이 있어서 놀랐다',
  '기계가 숨쉬는 소리 같았어요',
  '콘크리트가 이렇게 부드러울 수 있나',
  '물컵에 담긴 식물이 오래 기억날 듯',
  '분홍색이 생각보다 슬펐다',
  '여기 오래 서 있었어요',
  '안개 냄새가 났다',
  '전선이 예뻐 보이는 건 처음',
  '살아있는 게 뭔지 잘 모르겠다',
  '돌 위에 풀이 자란다는 게',
  '밤에 다시 오고 싶다',
  '소리가 없어서 더 좋았어요',
  '손대면 안 되는 걸 알면서도',
  '이게 죽으면 어떻게 되나요',
  '내 방에도 두고 싶다',
  '습기가 느껴졌다',
  '기계랑 식물이 같이 있는 게 이상했다',
  '천천히 걸었어요',
  '화면 앞에 오래 있었다',
  '안개가 바닥으로 흐르는 게 좋았어',
  '산호처럼 보였다',
  '오늘 처음 본 초록',
  '조용해서 좋았습니다',
  '뭔가 자라고 있다는 느낌',
  '불빛이 따뜻했어요',
  '시멘트에서 나는 냄새',
  '다음에 또 올게요',
  '공생이 이런 거구나',
  '차가운데 살아있음',
  '무서운데 계속 보게 된다',
  '손끝이 축축해지는 기분',
  '이끼는 누가 심은 걸까',
  '벽돌이 숨쉬는 것 같다',
  '아무 말도 안 하고 있었어요',
  '무엇이 무엇을 먹고 사는지',
  '돌이 이렇게 따뜻할 줄이야',
  '또 보러 올 것 같아요',
];
