/* =====================================================================
   욕설 · 스팸 걸러내기 (로컬 모드용)

   서버 모드에서는 Supabase 트리거가 같은 일을 한다 (schema.sql 3번).
   그쪽이 진짜 방어선이다 — 클라이언트 코드는 누구나 뜯어고칠 수 있으니까.
   하지만 로컬 모드에는 서버가 없으므로 여기가 유일한 필터다.
   상대는 "전시장에서 장난쳐보는 관람객"이므로 이 정도면 실효가 있다.

   걸린 글은 삭제하지 않고 조용히 격리한다.
     · 작성자 화면에는 정상 등록된 것처럼 보인다 (반응을 주면 더 시도한다)
     · 화면에는 뜨지 않는다
     · 기록은 남아 있어서 나중에 검토하고 되살릴 수 있다
   ===================================================================== */

const WORDS = [
  '시발', '씨발', '씨빨', '시팔', '씨팔', 'ㅅㅂ', 'ㅄ', '병신', '븅신',
  '개새끼', '새끼', '좆', '좃', '지랄', '염병', '니미', '니애미',
  '창녀', '창놈', '보지', '자지', '섹스', '강간', '한남', '한녀', '김치녀',
  '된장녀', '맘충', '급식충', '틀딱', '짱깨', '쪽바리', '쪽발이', '깜둥이',
  '전라디언', '홍어', '일베', '메갈', '운지',
  'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'nigger', 'nigga', 'faggot',
  'retard', 'whore', 'slut', 'rape',
];

/** 한글/영문/숫자만 남긴다 — "시 발", "시.발" 같은 회피를 무력화 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, '');
}

const NORMALIZED = WORDS.map(normalize).filter(Boolean);

export type FlagReason = 'word' | 'link' | 'repeat' | null;

/** 걸러야 할 글이면 사유를, 통과면 null 을 준다 */
export function screen(body: string, nickname: string | null): FlagReason {
  const hay = normalize(`${body} ${nickname ?? ''}`);

  for (const w of NORMALIZED) {
    if (hay.includes(w)) return 'word';
  }

  // 링크 · 연락처 스팸
  if (/(https?:\/\/|www\.|\.com|\.net|\.kr|@[a-z0-9]+\.[a-z]{2,})/i.test(body)) {
    return 'link';
  }

  // 같은 글자 8회 이상 반복
  if (/(.)\1{7,}/.test(body)) return 'repeat';

  return null;
}
