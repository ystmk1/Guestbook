# Sympoiesis

ACT 2026 전시 방명록.

크림색 종이 판면 위에 스캔 오브젝트가 놓이고, 그 아래 잉크 덩어리가
텍스트 박스의 패딩 경계를 따라 울렁인다. 남긴 줄은 그 위에 한 줄씩 쌓인다.

---

## 실행

```bash
npm install
npm run dev        # http://localhost:5173
npm run build
npm run preview
```

기록은 이 브라우저의 `localStorage` 에 저장된다. 인터넷 없이 동작한다.

---

## 조판

International Typographic Style. Inter + Pretendard 조합.

- 커닝·합자·문맥 대체(`kern` / `liga` / `calt`)를 전역으로 켜고, 숫자는
  타뷸러로 고정해 열이 흔들리지 않게 했다
- 자간은 크기에 따라 광학 보정한다 — 제호는 `-0.038em` 까지 조이고,
  작은 대문자 레이블은 `0.19em` 으로 벌린다
- 본문은 좌측 정렬 · 우측 흘림. 가운데 정렬을 쓰지 않는다
- 구분자는 가운뎃점 대신 14px 헤어라인(`.tick`)
- 번호 열(`3.4em`)과 본문 열의 그리드를 피드와 입력줄이 공유해서
  기준선과 열이 정확히 맞는다

색은 레퍼런스(잉크가 활자를 덮은 인쇄물)에서 가져왔다.

| | |
| --- | --- |
| `--paper` | `#d9d2c4` 종이 |
| `--ink` | `#15110d` 잉크 |
| `--sepia` | `#6b5f51` 중간 톤 |

`feTurbulence` 를 데이터 URI 로 한 번만 래스터라이즈해 판면 전체에
인쇄물 입자를 얹는다 — 매 프레임 비용이 없다.

---

## 잉크 블롭 — [`src/ink.ts`](src/ink.ts)

둥근 사각 윤곽을 등간격으로 168점 샘플링하고, 각 점을 **바깥 법선 방향**으로
밀어 유기적인 덩어리를 만든다. 변위는 둘레 위치의 **정수 배음 합**이라
한 바퀴가 정확히 닫힌다 — 이음매가 없고 노이즈 라이브러리도 필요 없다.

밀어내는 양은 **텍스트 박스의 패딩보다 작게** 잡는다.

```
캔버스 가장자리 ──── 0.42×pad ──── 기저선 ──── ±0.34×pad ──── 잉크 경계
텍스트는 1.0×pad 부터 시작 → 최소 0.24×pad 만큼 항상 떨어져 있다
```

그래서 아무리 울렁여도 글자를 덮지 않는다. 패딩이 곧 잉크가 번질 여백이다.
바깥에는 튄 방울 9개가 각자의 위상으로 함께 떤다.

---

## 오브젝트 — [`src/model.ts`](src/model.ts)

그림자·후처리·환경맵 없음. 조명 3개와 메시 하나.
배경이 투명이라 종이색이 그대로 비친다.
화면 밖이거나 탭이 가려지면 렌더를 멈춘다.

### GLB 최적화

원본 스캔은 **8192×8192 JPEG 4장 때문에 29 MB** 였다.

| | |
| --- | --- |
| 원본 | 29.09 MB |
| 텍스처 2K 리사이즈 | 5.01 MB |
| WebP (q82) | 4.23 MB |
| meshopt 지오메트리 압축 | **1.95 MB** |

원본 `.glb` 는 `.gitignore` 로 제외되고 `public/model.glb` 만 배포된다.
스캔을 새로 뽑으면 다시 돌리면 된다:

```bash
npm run model --src="새파일.glb"
```

---

## 성능

`three` 는 동적 import 로 떼어냈다. 판면과 잉크는 3D 번들을 기다리지 않는다.

| | gzip |
| --- | --- |
| 첫 화면 (HTML + CSS + JS) | **약 7 KB** |
| three (뒤이어 로드) | 130 KB |
| 모델 뷰어 | 21 KB |
| `model.glb` | 1.95 MB |

---

## 구조

```
index.html
src/
  main.ts       배선 · 피드 렌더
  style.css     조판 시스템
  ink.ts        잉크 블롭
  model.ts      GLB 뷰어 (동적 로드)
  store.ts      localStorage (Supabase 전환 가능)
  filter.ts     욕설·스팸
  config.ts
supabase/
  schema.sql    서버 모드로 갈 때 쓸 스키마
```

---

## 서버 모드

여러 기기에서 같이 쓰려면 Supabase 를 붙인다.
[`supabase/schema.sql`](supabase/schema.sql) 을 SQL Editor 에 붙여넣고,
Vercel 환경변수에 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 를 넣으면 된다.

> 지금 [`src/store.ts`](src/store.ts) 는 로컬 저장만 구현되어 있다.
> 서버 모드 배선은 아직 붙이지 않았다.

---

## 참고

- 욕설·스팸에 걸린 줄은 지우지 않고 조용히 격리한다. 작성자 화면에는
  등록된 것처럼 보이고 판면에만 안 뜬다 — 막혔다는 반응을 주면 더 시도한다.
  금칙어는 [`src/filter.ts`](src/filter.ts) 의 `WORDS` 에 있다.
- 브라우저 데이터를 지우면 기록도 사라진다. 콘솔에서 `store.toJSON()` 으로
  꺼내둘 수 있다.
- 기록은 "그 브라우저의 그 주소"에 묶인다. `localhost` 로 쓰다가 Vercel URL
  로 바꾸면 이전 기록이 안 보인다 — 처음부터 한쪽으로 정할 것.
