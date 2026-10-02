/* 붙여넣기 일괄 등록: CSV 또는 탭 구분 텍스트 파싱 (PRD F1-3) */
(function (STM) {
  'use strict';

  const C = STM.constants;
  const { normalizeDate, safeUrl } = STM.utils;

  // 헤더가 없을 때의 열 순서
  const COLUMNS = ['docNo', 'type', 'title', 'date', 'issuer', 'summary', 'url', 'category'];
  const HEADER_ALIASES = {
    docNo: ['문서번호', '번호', '사건번호'],
    type: ['구분', '유형'],
    title: ['제목', '사건명', '안건명'],
    date: ['날짜', '공개일', '선고일', '공개일/선고일', '일자'],
    issuer: ['기관', '발행기관', '법원'],
    summary: ['요지', '내용', '판결요지'],
    url: ['링크', 'url', 'URL', '원문', '원문링크'],
    category: ['세목'],
  };

  // RFC 4180 방식: 따옴표 안의 구분자·줄바꿈을 허용한다.
  function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else quoted = false;
        } else field += ch;
      } else if (ch === '"' && field === '') quoted = true;
      else if (ch === delimiter) {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  function headerMap(firstRow) {
    const map = {};
    firstRow.forEach((cell, i) => {
      const name = cell.trim().replace(/^﻿/, '');
      for (const key of Object.keys(HEADER_ALIASES)) {
        if (HEADER_ALIASES[key].includes(name) && map[key] === undefined) map[key] = i;
      }
    });
    return map.docNo !== undefined && map.title !== undefined ? map : null;
  }

  function guessType(value, context) {
    const v = (value || '').trim();
    if (C.TYPES.includes(v)) return v;
    const s = `${v} ${context}`;
    if (/심판/.test(s)) return '심판례';
    if (/판례|판결|대법원|고등법원|지방법원|행정법원/.test(s)) return '판례';
    if (/해석/.test(s)) return '해석례';
    return '예규';
  }

  // 반환: { rows: [{ line, data?, error? }] } — data는 createRuling에 넣을 필드
  function parse(text) {
    const src = String(text || '').replace(/^﻿/, '');
    const firstLine = src.split(/\r?\n/, 1)[0] || '';
    const delimiter = firstLine.includes('\t') ? '\t' : ',';
    const table = parseDelimited(src, delimiter);
    if (!table.length) return { rows: [] };

    const header = headerMap(table[0]);
    const body = header ? table.slice(1) : table;
    const index = header || Object.fromEntries(COLUMNS.map((k, i) => [k, i]));
    const seen = new Set();

    const rows = body.map((cells, i) => {
      const line = i + (header ? 2 : 1);
      const get = (key) => (index[key] !== undefined ? (cells[index[key]] || '').trim() : '');
      const docNo = get('docNo');
      const title = get('title');
      const date = normalizeDate(get('date'));
      if (!docNo) return { line, error: '문서번호가 없습니다.' };
      if (!title) return { line, error: '제목이 없습니다.' };
      if (!date) return { line, error: `날짜를 해석할 수 없습니다: "${get('date')}"` };
      const key = C.docNoKey(docNo);
      if (seen.has(key)) return { line, error: `붙여넣은 내용 안에서 문서번호가 중복됩니다: ${docNo}` };
      seen.add(key);

      const summary = get('summary');
      const rawCategory = get('category');
      const category = C.CATEGORIES.includes(rawCategory) ? rawCategory : C.guessCategory(`${title} ${summary}`);
      const url = get('url');
      return {
        line,
        data: {
          docNo: docNo.slice(0, 100),
          type: guessType(get('type'), `${title} ${get('issuer')}`),
          title: title.slice(0, 300),
          date,
          issuer: get('issuer').slice(0, 100),
          summary: summary.slice(0, 5000),
          url: url && safeUrl(url) ? url : '',
          category,
          categoryByUser: C.CATEGORIES.includes(rawCategory),
          source: 'paste',
        },
      };
    });
    return { rows };
  }

  STM.importer = { parse, parseDelimited };
})(window.STM);
