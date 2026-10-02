/* 백업·내보내기: JSON 내보내기/가져오기, CSV 내보내기 (PRD F6-3, F6-4) */
(function (STM) {
  'use strict';

  const C = STM.constants;
  const { download, todayStr, isDateStr, safeUrl } = STM.utils;

  const FORMAT = 'steelTaxMonitor.backup';
  const FORMAT_VERSION = 1;

  // 설정(API 키 등)은 백업에 넣지 않는다.
  async function exportJson() {
    const rulings = await STM.db.getAllRaw();
    const payload = { format: FORMAT, version: FORMAT_VERSION, exportedAt: new Date().toISOString(), rulings };
    download(`세무동향_백업_${todayStr()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    STM.settings.set({ lastBackupAt: payload.exportedAt });
    return rulings.length;
  }

  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const isoOrNull = (v) => (typeof v === 'string' && !isNaN(Date.parse(v)) ? v : null);

  function sanitizeAnalysis(a) {
    if (!a || typeof a !== 'object') return C.emptyAnalysis();
    return {
      implications: strList(a.implications),
      reviewItems: Array.isArray(a.reviewItems)
        ? a.reviewItems.filter((it) => it && typeof it.text === 'string').map((it) => ({ text: it.text, checked: it.checked === true }))
        : [],
      relatedRefs: strList(a.relatedRefs),
      model: typeof a.model === 'string' ? a.model : null,
      analyzedAt: isoOrNull(a.analyzedAt),
      editedAt: isoOrNull(a.editedAt),
      suggestedCategory: C.CATEGORIES.includes(a.suggestedCategory) ? a.suggestedCategory : null,
      suggestedRelevance: C.RELEVANCE.includes(a.suggestedRelevance) ? a.suggestedRelevance : null,
    };
  }

  // 외부 파일에서 온 레코드는 신뢰하지 않고 필드별로 검증해 다시 만든다. 필수값이 없으면 null.
  function sanitizeRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const docNo = str(raw.docNo, 100).trim();
    const title = str(raw.title, 300).trim();
    if (!docNo || !title) return null;
    const now = new Date().toISOString();
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : STM.utils.uuid(),
      docNo,
      type: C.TYPES.includes(raw.type) ? raw.type : '예규',
      title,
      summary: str(raw.summary, 5000),
      issuer: str(raw.issuer, 100),
      date: isDateStr(raw.date) ? raw.date : '',
      url: safeUrl(raw.url) ? raw.url : '',
      category: C.CATEGORIES.includes(raw.category) ? raw.category : C.guessCategory(title),
      subCategories: strList(raw.subCategories).filter((c) => C.CATEGORIES.includes(c)),
      relevance: C.RELEVANCE.includes(raw.relevance) ? raw.relevance : null,
      categoryByUser: typeof raw.categoryByUser === 'boolean' ? raw.categoryByUser : undefined,
      relevanceByUser: typeof raw.relevanceByUser === 'boolean' ? raw.relevanceByUser : undefined,
      status: C.STATUSES.includes(raw.status) ? raw.status : '미검토',
      analysis: sanitizeAnalysis(raw.analysis),
      prevAnalysis: raw.prevAnalysis ? sanitizeAnalysis(raw.prevAnalysis) : null,
      editedByUser: raw.editedByUser === true,
      memo: str(raw.memo, 5000),
      source: ['auto', 'manual', 'paste'].includes(raw.source) ? raw.source : 'manual',
      createdAt: isoOrNull(raw.createdAt) || now,
      updatedAt: isoOrNull(raw.updatedAt) || now,
      deletedAt: isoOrNull(raw.deletedAt),
    };
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
      reader.readAsText(file, 'utf-8');
    });
  }

  async function parseBackupFile(file) {
    let json;
    try {
      json = JSON.parse((await readFile(file)).replace(/^﻿/, ''));
    } catch (e) {
      throw new Error('올바른 JSON 파일이 아닙니다.');
    }
    if (!json || json.format !== FORMAT || !Array.isArray(json.rulings)) throw new Error('이 앱에서 내보낸 백업 파일이 아닙니다.');

    // 파일 안에서 문서번호가 정확히 같은 건은 최신(updatedAt) 1건만 남긴다.
    // 표기만 다른 건(C.docNoKey가 같은 건)은 정규화 전에 따로 저장된 실제 레코드일 수 있으므로 지우지 않는다.
    const byDocNo = new Map();
    let invalid = 0;
    for (const raw of json.rulings) {
      const r = sanitizeRecord(raw);
      if (!r) {
        invalid++;
        continue;
      }
      const prev = byDocNo.get(r.docNo);
      if (!prev || r.updatedAt > prev.updatedAt) byDocNo.set(r.docNo, r);
    }
    return { records: Array.from(byDocNo.values()), invalid, exportedAt: json.exportedAt };
  }

  function countByKey(records) {
    const counts = new Map();
    for (const r of records) {
      const key = C.docNoKey(r.docNo);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  // 표기만 다른 문서번호를 가진 레코드 수 (담당자 확인 안내용)
  function countVariants(records) {
    const counts = countByKey(records);
    return records.filter((r) => counts.get(C.docNoKey(r.docNo)) > 1).length;
  }

  // mode: 'merge'(같은 문서번호면 더 최근에 수정된 쪽 유지) | 'overwrite'(현재 데이터 전부 교체)
  async function importJson(file, mode) {
    const { records, invalid } = await parseBackupFile(file);
    if (mode === 'overwrite') {
      await STM.db.bulkPut(records, { clear: true });
      return { added: records.length, updated: 0, skipped: 0, invalid, variants: countVariants(records) };
    }

    const existing = await STM.db.getAllRaw();
    // 정확히 같은 번호를 먼저 찾는다. 표기만 다른 번호(C.docNoKey)로 기존 건에 합치는 것은
    // 파일 안에 그 키를 가진 건이 하나뿐일 때만 한다. 여러 건이면 한 기존 건에 겹쳐 써서 데이터가 사라진다.
    const byExact = new Map(existing.map((r) => [r.docNo, r]));
    const byKey = new Map(existing.map((r) => [C.docNoKey(r.docNo), r]));
    const byId = new Map(existing.map((r) => [r.id, r]));
    const fileKeyCount = countByKey(records);
    const toWrite = [];
    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const r of records) {
      const key = C.docNoKey(r.docNo);
      const sameDoc = byExact.get(r.docNo) || (fileKeyCount.get(key) === 1 ? byKey.get(key) : null);
      if (sameDoc) {
        if (r.updatedAt > sameDoc.updatedAt) {
          // 기존 표기를 유지해야 unique 인덱스(docNo)와 충돌하지 않는다.
          toWrite.push(Object.assign({}, r, { id: sameDoc.id, docNo: sameDoc.docNo }));
          updated++;
        } else skipped++;
        continue;
      }
      // 문서번호는 새것이지만 id가 겹치면(다른 문서) 새 id를 준다.
      toWrite.push(byId.has(r.id) ? Object.assign({}, r, { id: STM.utils.uuid() }) : r);
      added++;
    }
    await STM.db.bulkPut(toWrite);
    const final = new Map(existing.map((r) => [r.id, r]));
    toWrite.forEach((r) => final.set(r.id, r));
    return { added, updated, skipped, invalid, variants: countVariants(Array.from(final.values())) };
  }

  // ---------- CSV ----------
  function csvCell(value) {
    let s = value === null || value === undefined ? '' : String(value);
    // 엑셀 수식 실행 방지
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  const bullets = (items) => items.map((t) => `• ${t}`).join('\n');

  function exportCsv(rulings) {
    const header = ['세목', '부 세목', '구분', '문서번호', '제목', '공개일/선고일', '발행기관', '관련도', '검토상태', '시사점', '세무담당자 검토사항', '관련 예규/판례 번호', '담당자 메모', '원문 링크'];
    const rows = rulings.map((r) => {
      const a = r.analysis || C.emptyAnalysis();
      return [
        r.category,
        (r.subCategories || []).join(', '),
        r.type,
        r.docNo,
        r.title,
        r.date,
        r.issuer,
        r.relevance || '',
        r.status,
        bullets(a.implications),
        a.reviewItems.map((it) => `${it.checked ? '☑' : '☐'} ${it.text}`).join('\n'),
        a.relatedRefs.join('\n'),
        r.memo,
        r.url,
      ];
    });
    const csv = [header].concat(rows).map((row) => row.map(csvCell).join(',')).join('\r\n');
    // UTF-8 BOM: 엑셀에서 한글이 깨지지 않게 한다.
    download(`세무동향_${todayStr()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
    return rulings.length;
  }

  function needsBackupReminder(count) {
    if (!count) return false;
    const last = Date.parse(STM.settings.get('lastBackupAt') || '');
    return isNaN(last) || Date.now() - last > 7 * 24 * 60 * 60 * 1000;
  }

  STM.backup = { exportJson, importJson, parseBackupFile, sanitizeRecord, exportCsv, csvCell, needsBackupReminder };
})(window.STM);
