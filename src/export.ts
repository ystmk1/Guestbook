import type { Entry } from './config';

/* =====================================================================
   방명록 전체를 PDF 한 장으로 내려받는다. (Ctrl + Alt + Shift + O)

   PDF 에 글자를 "글자로" 넣으려면 한글 폰트를 통째로 임베딩해야 한다.
   CID 서브셋을 만들어 넣는 일이라 코드도 무겁고 라이브러리도 커진다.
   그래서 페이지를 캔버스에 그려 JPEG 로 만든 뒤 PDF 에 이미지로 박는다.
   폰트 임베딩이 아예 필요 없고 외부 의존성도 없다.

   대신 PDF 안에서 글자를 긁어 복사할 수는 없다. 원문 데이터가 필요하면
   콘솔에서 store.toJSON() 을 쓰면 된다.
   ===================================================================== */

/** A4, 200dpi */
const PW = 1654;
const PH = 2339;

const MARGIN = 140;
const INDENT = 118;
const GUTTER = PW - MARGIN * 2;
const TEXT_W = GUTTER - INDENT;

const BODY_SIZE = 28;
const BODY_LEAD = 43;
const META_SIZE = 19;
const GAP = 38;

const FONT = '"SM3SJGothic", "Malgun Gothic", sans-serif';

const INK = '#171717';
const PENCIL = '#8a8a8a';
const HAIR = '#d2d2d2';

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

function stamp(ts: number): string {
  const d = new Date(ts);
  return (
    d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  );
}

function fileStamp(): string {
  const d = new Date();
  return (
    String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()) +
    '-' + pad(d.getHours()) + pad(d.getMinutes())
  );
}

/**
 * 폭에 맞춰 줄을 나눈다.
 * 한글은 아무 데서나 끊고, 라틴 낱말은 통째로 지킨다.
 * 낱말 하나가 줄보다 길면(긴 URL 등) 그때는 글자 단위로 쪼갠다 —
 * 안 그러면 페이지 밖으로 삐져나간다.
 */
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];

  for (const paragraph of text.split('\n')) {
    // 라틴/숫자는 낱말로 묶고, 나머지(한글·문장부호)는 한 글자씩
    const tokens: string[] = [];
    let buf = '';
    for (const ch of paragraph) {
      if (/[A-Za-z0-9@._'\-]/.test(ch)) {
        buf += ch;
      } else {
        if (buf) {
          tokens.push(buf);
          buf = '';
        }
        tokens.push(ch);
      }
    }
    if (buf) tokens.push(buf);

    const before = out.length;
    let line = '';
    const push = () => {
      if (line) out.push(line);
      line = '';
    };

    for (const token of tokens) {
      // 낱말 자체가 한 줄을 넘으면 글자 단위로 쪼갠다
      if (ctx.measureText(token).width > maxW) {
        for (const ch of token) {
          if (line && ctx.measureText(line + ch).width > maxW) push();
          line += ch;
        }
        continue;
      }
      if (line && ctx.measureText(line + token).width > maxW) push();
      line += token;
    }
    push();

    // 빈 줄도 한 줄로 친다
    if (out.length === before) out.push('');
  }

  return out.length ? out : [''];
}

/*  한 줄 = 그려질 한 행.
    기록 단위가 아니라 행 단위로 쪽을 나눈다. 글자수 제한이 없어져서
    기록 하나가 한 쪽보다 길어질 수 있는데, 기록 단위로 나누면 그런
    기록이 페이지 밖으로 넘쳐 잘린다. */
type Row =
  | { t: 'body'; text: string; label?: string }
  | { t: 'meta'; text: string }
  | { t: 'gap' };

const ROW_H = {
  body: BODY_LEAD,
  meta: META_SIZE + 24,
  gap: GAP,
} as const;

/** 캔버스 하나를 만들고 2D 컨텍스트를 준다 */
function sheet(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = PW;
  canvas.height = PH;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PW, PH);
  ctx.textBaseline = 'alphabetic';
  return { canvas, ctx };
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  page: number,
  pages: number,
  total: number,
): void {
  ctx.fillStyle = PENCIL;
  ctx.font = `20px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('SYMPOIESIS   GUESTBOOK', MARGIN, MARGIN - 34);

  ctx.textAlign = 'right';
  ctx.fillText(`${total} RECORDS`, PW - MARGIN, MARGIN - 34);

  ctx.strokeStyle = HAIR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN, MARGIN - 16.5);
  ctx.lineTo(PW - MARGIN, MARGIN - 16.5);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(MARGIN, PH - MARGIN + 16.5);
  ctx.lineTo(PW - MARGIN, PH - MARGIN + 16.5);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = PENCIL;
  ctx.font = `19px ${FONT}`;
  ctx.fillText(`${page} / ${pages}`, PW / 2, PH - MARGIN + 46);
  ctx.textAlign = 'left';
}

/** 첫 장 머리에 얹는 표제 */
function drawTitle(ctx: CanvasRenderingContext2D, entries: Entry[], y: number): number {
  ctx.fillStyle = INK;
  ctx.font = `64px ${FONT}`;
  ctx.fillText('Sympoiesis', MARGIN, y + 52);

  const first = entries[0]?.createdAt;
  const last = entries[entries.length - 1]?.createdAt;
  const span =
    first && last
      ? stamp(first).slice(0, 10) + '  —  ' + stamp(last).slice(0, 10)
      : '';

  ctx.fillStyle = PENCIL;
  ctx.font = `22px ${FONT}`;
  ctx.fillText(span, MARGIN, y + 96);

  ctx.strokeStyle = HAIR;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y + 128.5);
  ctx.lineTo(PW - MARGIN, y + 128.5);
  ctx.stroke();

  return y + 128 + 56;
}

/** 필요한 글자가 든 폰트 조각을 미리 받아둔다 */
async function ensureFont(entries: Entry[]): Promise<void> {
  // 캔버스의 fillText 는 DOM 과 달리 웹폰트를 알아서 받아오지 않는다.
  // 미리 받아두지 않으면 아직 안 받은 조각의 글자가 대체 폰트로 나온다.
  const text =
    'Sympoiesis SYMPOIESIS GUESTBOOK RECORDS 0123456789/.:—' +
    entries.map((e) => (e.name ?? '') + e.body).join('');

  try {
    await Promise.all([
      document.fonts.load(`${BODY_SIZE}px ${FONT}`, text),
      document.fonts.load(`64px ${FONT}`, 'Sympoiesis'),
    ]);
    await document.fonts.ready;
  } catch {
    /* 폰트를 못 받아도 대체 폰트로 그린다 */
  }
}

export function renderPages(entries: Entry[]): HTMLCanvasElement[] {
  const probe = sheet().ctx;
  probe.font = `${BODY_SIZE}px ${FONT}`;

  // 1) 모든 기록을 행으로 펼친다
  const rows: Row[] = [];
  entries.forEach((e, i) => {
    const lines = wrap(probe, e.body, TEXT_W);
    lines.forEach((text, k) => {
      rows.push({ t: 'body', text, label: k === 0 ? pad(i + 1, 3) : undefined });
    });
    rows.push({ t: 'meta', text: (e.name ? e.name + '   ·   ' : '') + stamp(e.createdAt) });
    rows.push({ t: 'gap' });
  });

  // 2) 행을 쪽에 담는다
  const bottom = PH - MARGIN;
  const firstTop = MARGIN + 128 + 56; // 첫 장은 표제만큼 내려서 시작
  const pages: Row[][] = [];

  let current: Row[] = [];
  let y = firstTop;

  for (const row of rows) {
    const h = ROW_H[row.t];

    if (current.length && y + h > bottom) {
      pages.push(current);
      current = [];
      y = MARGIN;
      // 쪽 첫머리의 빈 간격은 버린다
      if (row.t === 'gap') continue;
    }

    current.push(row);
    y += h;
  }
  if (current.length) pages.push(current);
  if (!pages.length) pages.push([]);

  // 3) 그린다
  return pages.map((pageRows, p) => {
    const { canvas, ctx } = sheet();
    drawFrame(ctx, p + 1, pages.length, entries.length);

    let cy = MARGIN;
    if (p === 0) cy = drawTitle(ctx, entries, cy);

    for (const row of pageRows) {
      if (row.t === 'gap') {
        cy += ROW_H.gap;
        continue;
      }

      if (row.t === 'meta') {
        ctx.fillStyle = PENCIL;
        ctx.font = `${META_SIZE}px ${FONT}`;
        ctx.fillText(row.text, MARGIN + INDENT, cy + META_SIZE);
        cy += ROW_H.meta;
        continue;
      }

      if (row.label) {
        ctx.fillStyle = PENCIL;
        ctx.font = `${META_SIZE}px ${FONT}`;
        ctx.fillText(row.label, MARGIN, cy + BODY_SIZE);
      }

      ctx.fillStyle = INK;
      ctx.font = `${BODY_SIZE}px ${FONT}`;
      ctx.fillText(row.text, MARGIN + INDENT, cy + BODY_SIZE);
      cy += ROW_H.body;
    }

    return canvas;
  });
}

/* ── PDF 조립 ────────────────────────────────────────────────────── */

function toBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/**
 * JPEG 들을 한 장씩 담은 최소 PDF.
 * 이미지만 넣으므로 폰트 자원이 필요 없다.
 */
export function buildPdf(images: Uint8Array[], w: number, h: number): Blob {
  // A4 포인트 크기
  const PT_W = 595.28;
  const PT_H = 841.89;

  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];

  const put = (data: string | Uint8Array) => {
    const b = typeof data === 'string' ? toBytes(data) : data;
    chunks.push(b);
    length += b.length;
  };

  const obj = (id: number, body: string) => {
    offsets[id] = length;
    put(`${id} 0 obj\n${body}\nendobj\n`);
  };

  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  const n = images.length;
  const pageIds: number[] = [];
  for (let i = 0; i < n; i++) pageIds.push(3 + i * 3);

  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(
    2,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${n} >>`,
  );

  for (let i = 0; i < n; i++) {
    const pageId = 3 + i * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;

    obj(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PT_W} ${PT_H}] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );

    const stream = `q ${PT_W} 0 0 ${PT_H} 0 0 cm /Im0 Do Q`;
    obj(
      contentId,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );

    const img = images[i];
    offsets[imageId] = length;
    put(
      `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`,
    );
    put(img);
    put('\nendstream\nendobj\n');
  }

  const maxId = 2 + n * 3;
  const xrefAt = length;

  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id++) {
    xref += String(offsets[id] ?? 0).padStart(10, '0') + ' 00000 n \n';
  }
  put(xref);
  put(`trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return new Blob([out], { type: 'application/pdf' });
}

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function jpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, 'image/jpeg', 0.92),
  );
  if (!blob) throw new Error('jpeg 인코딩 실패');
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * 사람이 읽고 기계가 다루기 쉬운 원문.
 * PDF 는 이미지라 글자를 긁을 수 없으므로 이쪽을 같이 남긴다.
 * 맨 앞에 BOM 을 넣어야 윈도우 메모장·엑셀이 한글을 깨뜨리지 않는다.
 */
function buildText(entries: Entry[]): Blob {
  const first = entries[0];
  const last = entries[entries.length - 1];

  const head = [
    'SYMPOIESIS · GUESTBOOK',
    `기록 ${entries.length}줄`,
    first && last ? `${stamp(first.createdAt)} — ${stamp(last.createdAt)}` : '',
    `내려받은 시각 ${stamp(Date.now())}`,
    '',
    '─'.repeat(52),
    '',
  ];

  const body = entries.map((e, i) => {
    const who = e.name ? `${e.name}   ·   ` : '';
    return `${pad(i + 1, 3)}   ${e.body}\n      ${who}${stamp(e.createdAt)}\n`;
  });

  // BOM 을 앞에 붙여야 윈도우 메모장·엑셀이 한글을 안 깨뜨린다
  const BOM = '\uFEFF';

  return new Blob([BOM + head.join('\n') + body.join('\n')], {
    type: 'text/plain;charset=utf-8',
  });
}

/**
 * 방명록 전체를 내려받는다.
 *   .txt — 원문. 긁어서 쓸 수 있다
 *   .pdf — 판면 그대로의 기록물
 * 진행 상황을 문자열로 알려준다.
 */
export async function exportLog(
  entries: Entry[],
  say: (msg: string) => void,
): Promise<void> {
  if (!entries.length) {
    say('기록이 없습니다');
    return;
  }

  const name = `sympoiesis-guestbook-${fileStamp()}`;

  // 가벼운 원문부터 먼저 확보한다. PDF 그리다 실패해도 이건 남는다.
  save(buildText(entries), `${name}.txt`);

  say('폰트를 준비하는 중…');
  await ensureFont(entries);

  say('페이지를 그리는 중…');
  const canvases = renderPages(entries);

  const images: Uint8Array[] = [];
  for (let i = 0; i < canvases.length; i++) {
    say(`페이지 ${i + 1} / ${canvases.length}`);
    images.push(await jpeg(canvases[i]));
    // 큰 캔버스를 붙들고 있지 않게 바로 놓아준다
    canvases[i].width = 0;
    canvases[i].height = 0;
  }

  const pdf = buildPdf(images, PW, PH);

  // 브라우저가 연달아 내려받는 걸 막는 경우가 있어 한 박자 띄운다
  window.setTimeout(() => save(pdf, `${name}.pdf`), 500);

  const mb = (pdf.size / 1048576).toFixed(1);
  say(`${entries.length}줄 · txt + pdf ${images.length}쪽 (${mb}MB) 내려받았습니다`);
}
