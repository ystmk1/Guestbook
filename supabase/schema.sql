-- =====================================================================
--  SYMPOIESIS GUESTBOOK  ·  Supabase schema
--  Supabase Dashboard > SQL Editor 에 통째로 붙여넣고 RUN 하면 끝.
--  여러 번 실행해도 안전 (idempotent).
--
--  ※ 실행 전에 아래 6번 항목의 'CHANGE-ME-1234' 를 본인 PIN 으로 교체할 것.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. 방명록 테이블
-- ---------------------------------------------------------------------
create table if not exists public.entries (
  id            uuid primary key default gen_random_uuid(),
  body          text not null,
  nickname      text,
  created_at    timestamptz not null default now(),
  hidden        boolean not null default false,
  flag_reason   text,
  client_id     text
);

-- 본문: 1~140자
alter table public.entries drop constraint if exists entries_body_len;
alter table public.entries add constraint entries_body_len
  check (char_length(btrim(body)) between 1 and 140);

-- 본문: 최대 3줄
alter table public.entries drop constraint if exists entries_body_lines;
alter table public.entries add constraint entries_body_lines
  check (array_length(string_to_array(body, chr(10)), 1) <= 3);

-- 닉네임: 비었으면 null, 있으면 1~16자
alter table public.entries drop constraint if exists entries_nick_len;
alter table public.entries add constraint entries_nick_len
  check (nickname is null or char_length(btrim(nickname)) between 1 and 16);

create index if not exists entries_created_at_idx on public.entries (created_at desc);
create index if not exists entries_visible_idx    on public.entries (created_at desc) where hidden = false;
create index if not exists entries_client_idx     on public.entries (client_id, created_at desc);


-- ---------------------------------------------------------------------
-- 2. 금칙어 사전
--    전시 중에도 이 테이블에 INSERT 하면 재배포 없이 즉시 반영된다.
-- ---------------------------------------------------------------------
create table if not exists public.banned_words (
  word text primary key
);

insert into public.banned_words (word) values
  ('시발'),('씨발'),('씨빨'),('시팔'),('씨팔'),('ㅅㅂ'),('ㅄ'),('병신'),('븅신'),
  ('개새끼'),('새끼'),('좆'),('좃'),('지랄'),('염병'),('니미'),('니애미'),
  ('창녀'),('창놈'),('보지'),('자지'),('섹스'),('강간'),('한남'),('한녀'),('김치녀'),
  ('된장녀'),('맘충'),('급식충'),('틀딱'),('짱깨'),('쪽바리'),('쪽발이'),('깜둥이'),
  ('전라디언'),('홍어'),('일베'),('메갈'),('운지'),
  ('fuck'),('shit'),('bitch'),('cunt'),('asshole'),('nigger'),('nigga'),('faggot'),
  ('retard'),('whore'),('slut'),('rape')
on conflict (word) do nothing;


-- ---------------------------------------------------------------------
-- 3. 서버측 필터  (클라이언트 우회 불가)
--    걸리면 삭제가 아니라 hidden=true 로 조용히 격리한다.
--    → 작성자 화면에서는 정상 등록된 것처럼 보이고, 전시 화면에만 안 뜬다.
-- ---------------------------------------------------------------------
create or replace function public.entries_screen()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  haystack text;
  hit      text;
begin
  new.body     := btrim(new.body);
  new.nickname := nullif(btrim(coalesce(new.nickname, '')), '');

  -- 작성자가 hidden / flag_reason / created_at 을 임의 지정하지 못하게 강제
  new.hidden      := false;
  new.flag_reason := null;
  new.created_at  := now();

  -- 정규화: 소문자 + 한글/영문/숫자만 남김
  -- ("시 발", "시.발", "ㅅㅣ발" 류의 띄어쓰기·기호 회피 차단)
  haystack := lower(new.body || ' ' || coalesce(new.nickname, ''));
  haystack := regexp_replace(haystack, '[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]', '', 'g');

  select w.word into hit
  from public.banned_words w
  where position(
          regexp_replace(lower(w.word), '[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]', '', 'g')
          in haystack
        ) > 0
  limit 1;

  if hit is not null then
    new.hidden := true;
    new.flag_reason := 'word';
    return new;
  end if;

  -- 링크 / 연락처 스팸
  if new.body ~* '(https?://|www\.|\.com|\.net|\.kr|@[a-z0-9]+\.[a-z]{2,})' then
    new.hidden := true;
    new.flag_reason := 'link';
    return new;
  end if;

  -- 같은 글자 8회 이상 반복 (ㅋㅋㅋㅋㅋㅋㅋㅋ, aaaaaaaa)
  if new.body ~ '(.)\1{7,}' then
    new.hidden := true;
    new.flag_reason := 'repeat';
    return new;
  end if;

  return new;
end;
$fn$;

drop trigger if exists entries_screen_trg on public.entries;
create trigger entries_screen_trg
  before insert on public.entries
  for each row execute function public.entries_screen();


-- ---------------------------------------------------------------------
-- 4. 도배 방지  ·  같은 기기 10초 내 재작성 차단 / 1시간 30건 상한
-- ---------------------------------------------------------------------
create or replace function public.entries_throttle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  recent int;
begin
  if new.client_id is null then
    return new;
  end if;

  select count(*) into recent
  from public.entries e
  where e.client_id = new.client_id
    and e.created_at > now() - interval '10 seconds';

  if recent > 0 then
    raise exception 'throttled: too fast' using errcode = 'P0001';
  end if;

  select count(*) into recent
  from public.entries e
  where e.client_id = new.client_id
    and e.created_at > now() - interval '1 hour';

  if recent >= 30 then
    raise exception 'throttled: hourly limit' using errcode = 'P0001';
  end if;

  return new;
end;
$fn$;

drop trigger if exists entries_throttle_trg on public.entries;
create trigger entries_throttle_trg
  before insert on public.entries
  for each row execute function public.entries_throttle();


-- ---------------------------------------------------------------------
-- 5. RLS  ·  익명은 "숨겨지지 않은 글 읽기 + 글쓰기"만 가능
-- ---------------------------------------------------------------------
alter table public.entries      enable row level security;
alter table public.banned_words enable row level security;  -- 정책 없음 = 익명 접근 전면 차단

drop policy if exists entries_read_visible on public.entries;
create policy entries_read_visible on public.entries
  for select to anon, authenticated
  using (hidden = false);

drop policy if exists entries_insert_any on public.entries;
create policy entries_insert_any on public.entries
  for insert to anon, authenticated
  with check (true);

-- UPDATE / DELETE 정책은 일부러 만들지 않는다 → 익명은 수정·삭제 불가.
-- 숨김은 아래 6번의 RPC 로만 가능.


-- ---------------------------------------------------------------------
-- 6. 관리자 PIN  ·  전시장에서 Ctrl+Shift+H 로 부적절한 글 즉시 숨기기
--
--    ▼▼▼ 아래 'CHANGE-ME-1234' 를 반드시 본인 PIN 으로 바꿔서 실행할 것 ▼▼▼
-- ---------------------------------------------------------------------
create table if not exists public.admin_config (
  id       int primary key default 1,
  pin_hash text not null,
  constraint admin_config_singleton check (id = 1)
);
alter table public.admin_config enable row level security;  -- 정책 없음 = 익명 접근 전면 차단

insert into public.admin_config (id, pin_hash)
values (1, crypt('CHANGE-ME-1234', gen_salt('bf')))
on conflict (id) do nothing;

-- PIN 을 나중에 바꾸려면 이 한 줄만 다시 실행:
--   update public.admin_config set pin_hash = crypt('새PIN', gen_salt('bf')) where id = 1;

create or replace function public.admin_hide_entry(p_id uuid, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  ok boolean;
begin
  select (pin_hash = crypt(p_pin, pin_hash)) into ok
  from public.admin_config where id = 1;

  if not coalesce(ok, false) then
    perform pg_sleep(1);            -- 무차별 대입 지연
    raise exception 'bad pin' using errcode = 'P0001';
  end if;

  update public.entries
     set hidden = true, flag_reason = 'admin'
   where id = p_id;

  return true;
end;
$fn$;

revoke all on function public.admin_hide_entry(uuid, text) from public;
grant execute on function public.admin_hide_entry(uuid, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 7. Realtime  ·  새 글이 다른 화면에도 즉시 뜨게
-- ---------------------------------------------------------------------
alter table public.entries replica identity full;

do $rt$
begin
  alter publication supabase_realtime add table public.entries;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$rt$;


-- ---------------------------------------------------------------------
-- 8. 운영용 조회 (필요할 때 SQL Editor 에서 수동 실행)
-- ---------------------------------------------------------------------
-- 자동 격리된 글 확인:
--   select created_at, flag_reason, nickname, body
--     from public.entries where hidden order by created_at desc;
--
-- 오탐 복구:
--   update public.entries set hidden = false, flag_reason = null where id = '...';
--
-- 전시 종료 후 전체 내보내기:
--   select created_at, nickname, body
--     from public.entries where not hidden order by created_at;
