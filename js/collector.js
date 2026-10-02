/* 최근 N일 예규/판례 수집: 법제처 국가법령정보 Open API (PRD F1) */
(function (STM) {
  'use strict';

  const C = STM.constants;
  const { todayStr, addDays, normalizeDate } = STM.utils;

  const DRF = 'https://www.law.go.kr/DRF';
  const PAGE_SIZE = 100;
  const MAX_PAGES = 5;

  class CollectError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  // 판례(prec)와 법령해석례(expc)를 수집한다. 응답 필드명은 API 문서 기준이며, 형식이 달라도 최대한 읽어낸다.
  const TARGETS = [
    {
      target: 'prec',
      label: '판례',
      dateParam: 'prncYd',
      listKeys: ['PrecSearch', 'prec'],
      detailKey: 'PrecService',
      toCandidate: (it) => ({
        id: pick(it, ['판례일련번호', 'id']),
        docNo: [pick(it, ['법원명']), pick(it, ['사건번호'])].filter(Boolean).join(' '),
        type: '판례',
        title: pick(it, ['사건명']),
        date: normalizeDate(pick(it, ['선고일자'])),
        issuer: pick(it, ['법원명']),
        kind: pick(it, ['사건종류명']),
        url: (seq) => `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${encodeURIComponent(seq)}`,
      }),
      summaryFields: ['판시사항', '판결요지'],
    },
    {
      target: 'expc',
      label: '법령해석례',
      dateParam: 'explYd',
      listKeys: ['Expc', 'expc'],
      detailKey: 'ExpcService',
      toCandidate: (it) => ({
        id: pick(it, ['법령해석례일련번호', 'id']),
        docNo: ['법제처', pick(it, ['안건번호'])].filter(Boolean).join(' '),
        type: '해석례',
        title: pick(it, ['안건명']),
        date: normalizeDate(pick(it, ['회신일자', '해석일자'])),
        issuer: pick(it, ['회신기관명', '해석기관명']) || '법제처',
        kind: '',
        url: (seq) => `https://www.law.go.kr/LSW/expcInfoP.do?expcSeq=${encodeURIComponent(seq)}`,
      }),
      summaryFields: ['질의요지', '회답'],
    },
  ];

  function pick(obj, keys) {
    for (const k of keys) {
      const v = obj && obj[k];
      if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
    }
    return '';
  }

  // HTML 태그를 텍스트로 바꾼다. 결과는 문자열로만 쓰이므로 DOM에 주입되지 않는다.
  function stripHtml(s) {
    return String(s || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // 프록시 URL에 {url}이 있으면 그 자리에, 없으면 끝에 인코딩한 원래 주소를 붙인다.
  function viaProxy(url) {
    const proxy = (STM.settings.get('proxyUrl') || '').trim();
    if (!proxy) return url;
    const encoded = encodeURIComponent(url);
    return proxy.includes('{url}') ? proxy.replace('{url}', encoded) : proxy + encoded;
  }

  async function fetchJson(url) {
    let res;
    try {
      res = await fetch(viaProxy(url));
    } catch (e) {
      throw new CollectError(
        'CORS',
        '브라우저 보안 정책(CORS) 또는 네트워크 문제로 법제처 API에 접속하지 못했습니다. 설정에서 프록시 URL을 지정하거나 [붙여넣기 등록]을 이용하세요.'
      );
    }
    if (!res.ok) throw new CollectError('HTTP', `법제처 API가 오류를 반환했습니다 (${res.status}).`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new CollectError('BAD_RESPONSE', '법제처 API 응답을 해석하지 못했습니다. 설정의 법제처 인증키(OC)가 올바른지 확인하세요.');
    }
  }

  function asArray(v) {
    if (!v) return [];
    return Array.isArray(v) ? v : [v];
  }

  function listItems(json, keys) {
    const root = json && json[keys[0]];
    return asArray(root && root[keys[1]]);
  }

  async function fetchList(t, oc, from, to) {
    const range = `${from.replace(/-/g, '')}~${to.replace(/-/g, '')}`;
    const items = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const params = new URLSearchParams({ OC: oc, target: t.target, type: 'JSON', query: '세', display: String(PAGE_SIZE), page: String(page) });
      params.set(t.dateParam, range);
      const json = await fetchJson(`${DRF}/lawSearch.do?${params}`);
      const batch = listItems(json, t.listKeys);
      items.push(...batch);
      if (batch.length < PAGE_SIZE) return { items, truncated: false };
    }
    // 마지막 페이지까지 꽉 찼으면 뒤에 결과가 더 남아 있을 수 있다.
    return { items, truncated: true };
  }

  async function fetchSummary(t, oc, seq) {
    const params = new URLSearchParams({ OC: oc, target: t.target, ID: seq, type: 'JSON' });
    const json = await fetchJson(`${DRF}/lawService.do?${params}`);
    const body = (json && json[t.detailKey]) || json || {};
    return t.summaryFields
      .map((f) => {
        const v = stripHtml(body[f]);
        return v ? `[${f}] ${v}` : '';
      })
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 5000);
  }

  // 반환: { candidates: Ruling 필드 객체[], errors: string[], warnings: string[](결과 잘림 등), from, to }
  // knownDocNos에 있는 건은 상세(요지) 조회를 생략한다.
  async function collect(knownDocNos, onStatus) {
    const s = STM.settings.get();
    const oc = (s.lawApiKey || '').trim();
    if (!oc) throw new CollectError('NO_KEY', '법제처 Open API 인증키(OC)가 없습니다. 설정에서 입력하거나 [붙여넣기 등록]을 이용하세요.');

    const to = todayStr();
    const from = addDays(to, -(Number(s.periodDays) || 7));
    const candidates = [];
    const errors = [];
    const warnings = [];

    for (const t of TARGETS) {
      if (onStatus) onStatus(`${t.label} 목록을 가져오는 중…`);
      let items;
      try {
        const list = await fetchList(t, oc, from, to);
        items = list.items;
        if (list.truncated) {
          warnings.push(
            `${t.label}: 검색 결과가 ${PAGE_SIZE * MAX_PAGES}건을 넘어 앞의 ${PAGE_SIZE * MAX_PAGES}건만 확인했습니다. 설정에서 수집 기간을 줄여 다시 수집하세요.`
          );
        }
      } catch (err) {
        errors.push(`${t.label}: ${err.message}`);
        if (err.code === 'CORS') break; // 다른 대상도 같은 이유로 실패한다
        continue;
      }

      const found = items
        .map((it) => ({ raw: t.toCandidate(it), t }))
        .filter(({ raw }) => raw.docNo && raw.title && raw.date && raw.date >= from && raw.date <= to)
        .filter(({ raw }) => raw.kind === '세무' || C.isTaxRelated(raw.title));

      for (let i = 0; i < found.length; i++) {
        const { raw } = found[i];
        let summary = '';
        if (raw.id && !knownDocNos.has(C.docNoKey(raw.docNo))) {
          if (onStatus) onStatus(`${t.label} 요지를 가져오는 중… (${i + 1}/${found.length})`);
          try {
            summary = await fetchSummary(t, oc, raw.id);
          } catch (err) {
            summary = '';
          }
        }
        candidates.push({
          docNo: raw.docNo,
          type: raw.type,
          title: raw.title,
          date: raw.date,
          issuer: raw.issuer,
          summary,
          url: raw.id ? raw.url(raw.id) : '',
          category: C.guessCategory(`${raw.title} ${summary}`),
          categoryByUser: false,
          source: 'auto',
        });
      }
    }

    if (errors.length && !candidates.length && errors.length >= TARGETS.length) throw new CollectError('FAILED', errors.join('\n'));
    if (errors.length && !candidates.length && errors.some((e) => e.includes('CORS'))) throw new CollectError('CORS', errors.join('\n'));
    return { candidates, errors, warnings, from, to };
  }

  STM.collector = { collect, stripHtml, CollectError };
})(window.STM);
