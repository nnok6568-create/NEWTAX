/* 상수와 기본 데이터 구조 (PRD 5.1) */
(function (STM) {
  'use strict';

  const ALL = '전체';
  const CATEGORIES = Object.freeze(['원천세', '부가세', '국제조세', '지방세', '법인세', '종합소득세']);
  const TYPES = Object.freeze(['예규', '판례', '심판례', '해석례']);
  const STATUSES = Object.freeze(['미검토', '검토중', '검토완료', '해당없음']);
  const RELEVANCE = Object.freeze(['상', '중', '하']);
  const RELEVANCE_ORDER = Object.freeze({ 상: 0, 중: 1, 하: 2 });

  // PRD 7장 보안: 사내 기밀정보 입력 지양 안내. 메모는 전송되지 않고 브라우저에만 남는다.
  const CONFIDENTIAL_NOTICE =
    '요지에는 사내 기밀정보(거래처명, 거래 금액, 내부 검토 의견 등)를 넣지 마세요. AI 분석 시 문서번호·제목·요지가 Anthropic으로 전송됩니다.';

  const DB_NAME = 'steelTaxMonitor';
  const DB_VERSION = 1;
  const STORE = 'rulings';
  const TRASH_RETENTION_DAYS = 30;

  function emptyAnalysis() {
    return { implications: [], reviewItems: [], relatedRefs: [], model: null, analyzedAt: null };
  }

  function hasAnalysis(analysis) {
    return !!analysis && (analysis.implications.length > 0 || analysis.reviewItems.length > 0 || analysis.relatedRefs.length > 0);
  }

  function createRuling(fields) {
    const now = new Date().toISOString();
    return Object.assign(
      {
        id: STM.utils.uuid(),
        docNo: '',
        type: '예규',
        title: '',
        summary: '',
        issuer: '',
        date: '',
        url: '',
        category: '법인세',
        subCategories: [],
        relevance: null,
        status: '미검토',
        analysis: emptyAnalysis(),
        prevAnalysis: null,
        editedByUser: false,
        memo: '',
        source: 'manual',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      fields
    );
  }

  // 중복 판별용 문서번호 키. 공백·하이픈·점 등 표기 차이와 전각/반각, 영문 대소문자를 무시한다.
  // 예: '대법원 2026두100' = '대법원2026두100', '서면-2026-법인-1234' = '서면 2026 법인 1234'
  function docNoKey(docNo) {
    return String(docNo || '')
      .normalize('NFKC')
      .replace(/[\s\-‐-―_.·]/g, '')
      .toUpperCase();
  }

  // 부 세목에 해당하는 건도 그 세목 탭에 포함한다 (PRD F4-3).
  function matchesCategory(ruling, category) {
    return category === ALL || ruling.category === category || (ruling.subCategories || []).includes(category);
  }

  // 세목/관련도를 담당자가 정했는지 여부. 담당자가 정한 값은 AI가 덮어쓰지 않고 제안만 한다.
  // 1단계에서 만든 데이터에는 플래그가 없으므로 직접 입력(manual) 건은 담당자가 정한 것으로 본다.
  function isCategoryByUser(r) {
    return typeof r.categoryByUser === 'boolean' ? r.categoryByUser : r.source === 'manual';
  }

  function isRelevanceByUser(r) {
    return typeof r.relevanceByUser === 'boolean' ? r.relevanceByUser : r.source === 'manual' && !!r.relevance;
  }

  // 키워드 기반 세목 추정 (수집·붙여넣기 건의 초기값. AI 분석 시 보정된다)
  const CATEGORY_KEYWORDS = [
    ['국제조세', /이전가격|국제조세|조세조약|국조법|국외|해외|외국법인|비거주자|고정사업장/],
    ['원천세', /원천징수|원천세|근로소득|퇴직소득|연말정산/],
    ['지방세', /지방세|취득세|재산세|등록면허세|지역자원시설세|주민세|지방소득세/],
    ['부가세', /부가가치세|부가세|매입세액|매출세액|세금계산서|영세율|면세|매입자납부|내국신용장|구매확인서/],
    ['법인세', /법인세|손금|익금|감가상각|세액공제|소득처분/],
    ['종합소득세', /종합소득|사업소득|양도소득|소득세/],
  ];

  function guessCategory(text) {
    const s = text || '';
    for (const [cat, re] of CATEGORY_KEYWORDS) if (re.test(s)) return cat;
    return '법인세';
  }

  const TAX_TEXT = /세무|조세|국세|지방세|법인세|소득세|부가가치세|취득세|재산세|등록면허세|상속세|증여세|종합부동산세|관세|원천징수|세금계산서|가산세|과세|세액|부과처분/;

  function isTaxRelated(text) {
    return TAX_TEXT.test(text || '');
  }

  // 정렬: 관련도(상>중>하>미정) → 날짜 내림차순
  function compareRulings(a, b) {
    const ra = a.relevance in RELEVANCE_ORDER ? RELEVANCE_ORDER[a.relevance] : 3;
    const rb = b.relevance in RELEVANCE_ORDER ? RELEVANCE_ORDER[b.relevance] : 3;
    if (ra !== rb) return ra - rb;
    return (b.date || '').localeCompare(a.date || '');
  }

  STM.constants = {
    ALL,
    CATEGORIES,
    TYPES,
    STATUSES,
    RELEVANCE,
    CONFIDENTIAL_NOTICE,
    DB_NAME,
    DB_VERSION,
    STORE,
    TRASH_RETENTION_DAYS,
    emptyAnalysis,
    hasAnalysis,
    createRuling,
    matchesCategory,
    compareRulings,
    docNoKey,
    isCategoryByUser,
    isRelevanceByUser,
    guessCategory,
    isTaxRelated,
  };
})(window.STM);
