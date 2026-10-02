/* 상세 화면: ① 시사점 → ② 세무담당자 검토사항 → ③ 관련 예규/판례 번호 순서 고정 (PRD F5, F3) */
(function (STM) {
  'use strict';

  const { el, safeUrl, debounce, formatDateTime } = STM.utils;
  const C = STM.constants;
  const { badge, meta, docMeta } = STM.ui.list;

  const NOT_ANALYZED = '아직 분석되지 않았습니다. 위의 [AI 분석]을 누르세요.';

  // ①②③은 PRD가 정한 고정 순서다.
  function section(no, title, body) {
    return el('section', { class: 'detail-section' }, [
      el('h3', null, [el('span', { class: 'section-no', 'aria-hidden': 'true' }, no), title]),
      el('div', { class: 'section-body' }, body),
    ]);
  }

  function placeholder() {
    return el('p', { class: 'placeholder' }, NOT_ANALYZED);
  }

  // 첫 분석 중에는 결과 자리를 회색 줄로 채워 둔다.
  function skeleton(lines) {
    return el(
      'div',
      { class: 'skeleton', 'aria-hidden': 'true' },
      Array.from({ length: lines }, () => el('span', { class: 'skeleton-line' }))
    );
  }

  function renderImplications(items) {
    if (!items.length) return placeholder();
    return el('ul', { class: 'bullet-list' }, items.map((t) => el('li', null, t)));
  }

  function renderReviewItems(items, onToggle) {
    if (!items.length) return placeholder();
    const fill = el('span', { class: 'progress-fill' });
    const label = el('span');
    const progress = el('div', { class: 'review-progress' }, [el('span', { class: 'progress-track', 'aria-hidden': 'true' }, fill), label]);
    const updateProgress = () => {
      const done = items.filter((it) => it.checked).length;
      label.textContent = `${done}/${items.length} 완료`;
      fill.style.width = `${Math.round((done / items.length) * 100)}%`;
    };
    updateProgress();
    const list = el(
      'ul',
      { class: 'check-list' },
      items.map((it, i) =>
        el('li', null, [
          el('label', null, [
            el('input', {
              type: 'checkbox',
              checked: it.checked,
              onchange: (e) => {
                it.checked = e.target.checked;
                updateProgress();
                onToggle(i, e.target.checked);
              },
            }),
            el('span', null, it.text),
          ]),
        ])
      )
    );
    return el('div', null, [progress, list]);
  }

  // 저장된 문서번호와 일치하면 "확인됨", 아니면 AI 제안으로 표시한다.
  function renderRelatedRefs(refs, knownDocNos) {
    if (!refs.length) return placeholder();
    return el(
      'ul',
      { class: 'ref-list' },
      refs.map((ref) => {
        const known = knownDocNos.has(C.docNoKey(ref)); // knownDocNos는 정규화 키 집합
        return el('li', null, [
          el('span', { class: 'doc-no' }, ref),
          ' ',
          el('span', { class: 'ref-tag ' + (known ? 'is-known' : 'is-unverified') }, known ? '확인됨' : 'AI 제안·원문 확인 필요'),
        ]);
      })
    );
  }

  // 담당자가 정한 세목/관련도와 AI 판단이 다를 때 제안을 보여준다.
  function renderSuggestions(r, analysis, h) {
    const items = [];
    if (analysis.suggestedCategory && analysis.suggestedCategory !== r.category) {
      items.push(
        el('p', { class: 'suggestion' }, [
          `AI 제안 세목: ${analysis.suggestedCategory}`,
          el('button', { type: 'button', onclick: () => h.onApplySuggestion({ category: analysis.suggestedCategory }) }, '적용'),
        ])
      );
    }
    if (analysis.suggestedRelevance && analysis.suggestedRelevance !== r.relevance) {
      items.push(
        el('p', { class: 'suggestion' }, [
          `AI 제안 관련도: ${analysis.suggestedRelevance}`,
          el('button', { type: 'button', onclick: () => h.onApplySuggestion({ relevance: analysis.suggestedRelevance }) }, '적용'),
        ])
      );
    }
    return items;
  }

  function renderAnalysisBar(r, analysis, analyzed, h) {
    const mainLabel = h.analyzing ? 'AI 분석 중' : analyzed ? '재분석' : 'AI 분석';
    return el('div', { class: 'analysis-bar' }, [
      el(
        'button',
        { type: 'button', class: h.analyzing ? 'is-busy' : analyzed ? null : 'btn-primary', disabled: h.analyzing, 'aria-busy': h.analyzing ? 'true' : null, onclick: h.onAnalyze },
        [h.analyzing ? el('span', { class: 'spinner', 'aria-hidden': 'true' }) : null, mainLabel]
      ),
      analyzed ? el('button', { type: 'button', disabled: h.analyzing, onclick: h.onEditAnalysis }, '분석 결과 편집') : null,
      C.hasAnalysis(r.prevAnalysis) ? el('button', { type: 'button', class: 'btn-quiet', disabled: h.analyzing, onclick: h.onRevertAnalysis }, '이전 분석으로 되돌리기') : null,
      ...renderSuggestions(r, analysis, h),
      // 처음 분석하기 전에만, 무엇이 외부로 전송되는지 알린다.
      analyzed ? null : el('p', { class: 'analysis-note' }, '[AI 분석]을 누르면 문서번호·제목·요지가 Anthropic으로 전송됩니다. 사내 기밀정보가 들어 있지 않은지 확인하세요.'),
    ]);
  }

  function disclaimer(analysis) {
    const info = [analysis.model, analysis.analyzedAt ? formatDateTime(analysis.analyzedAt) : null, analysis.editedAt ? '담당자 수정됨' : null].filter(Boolean);
    return el('p', { class: 'disclaimer' }, `AI가 작성한 분석입니다${info.length ? ` (${info.join(', ')})` : ''}. 최종 판단은 담당자가 원문을 확인한 뒤 내려 주세요.`);
  }

  function render(r, h) {
    const analysis = r.analysis || C.emptyAnalysis();
    const analyzed = C.hasAnalysis(analysis);
    const loading = h.analyzing && !analyzed;
    const link = r.url ? safeUrl(r.url) : null;

    const saveMemo = debounce((value) => h.onMemoChange(value), 500);
    const memo = el('textarea', {
      id: 'detail-memo',
      rows: '3',
      maxlength: '5000',
      placeholder: '검토 의견, 후속 조치 등을 남겨 두세요. 자동 저장됩니다.',
      value: r.memo || '',
      oninput: (e) => {
        h.onMemoInput(e.target.value);
        saveMemo(e.target.value);
      },
      onblur: () => saveMemo.flush(),
    });

    const status = el(
      'select',
      { id: 'detail-status', onchange: (e) => h.onStatusChange(e.target.value) },
      C.STATUSES.map((s) => el('option', { value: s, selected: s === r.status }, s))
    );

    const sourceLabel = { auto: '자동 수집', paste: '붙여넣기 등록', manual: '직접 입력' }[r.source] || '직접 입력';

    const node = el('div', { class: 'detail' }, [
      el('div', { class: 'detail-header' }, [
        el('div', { class: 'card-badges' }, [
          badge(r.category, 'category', r.category),
          ...(r.subCategories || []).map((c) => badge('부 ' + c, 'subcategory')),
          badge(r.type, 'type'),
          badge('관련도 ' + (r.relevance || '-'), 'relevance', r.relevance || 'none'),
          badge(r.status, 'status', r.status),
          r.editedByUser ? badge('담당자 수정', 'edited') : null,
        ]),
        docMeta(r),
        h.variantDocNos && h.variantDocNos.length
          ? el(
              'p',
              { class: 'variant-note', role: 'note' },
              `표기만 다른 문서번호가 있습니다: ${h.variantDocNos.join(', ')}. 같은 문서라면 한 건만 남기고 삭제하세요.`
            )
          : null,
        el('h2', { class: 'detail-title', id: 'detail-title' }, r.title),
        r.summary ? el('p', { class: 'detail-summary' }, r.summary) : null,
        link ? el('a', { class: 'source-link', href: link, target: '_blank', rel: 'noopener noreferrer', title: '새 창에서 열립니다' }, '원문 보기') : null,
      ]),
      renderAnalysisBar(r, analysis, analyzed, h),
      section('①', '시사점 (철강회사 관점)', loading ? skeleton(3) : renderImplications(analysis.implications)),
      section('②', '세무담당자 검토사항', loading ? skeleton(4) : renderReviewItems(analysis.reviewItems, h.onToggleReview)),
      section('③', '관련 예규/판례 번호', loading ? skeleton(2) : renderRelatedRefs(analysis.relatedRefs, h.knownDocNos)),
      analyzed ? disclaimer(analysis) : null,
      el('section', { class: 'detail-section detail-review' }, [
        el('div', { class: 'field' }, [el('label', { for: 'detail-status' }, '검토 상태'), status]),
        el('div', { class: 'field' }, [el('label', { for: 'detail-memo' }, '담당자 메모'), memo]),
        meta([el('span', null, `등록 ${formatDateTime(r.createdAt)}`), el('span', null, `수정 ${formatDateTime(r.updatedAt)}`), el('span', null, sourceLabel)], 'p'),
      ]),
      el('div', { class: 'detail-actions' }, [
        el('button', { type: 'button', class: 'btn-danger', onclick: h.onDelete }, '삭제'),
        el('button', { type: 'button', onclick: h.onEdit }, '수정'),
        el('button', { type: 'button', class: 'btn-primary', onclick: h.onClose }, '닫기'),
      ]),
    ]);

    return { node, flush: () => saveMemo.flush() };
  }

  STM.ui.detail = { render };
})(window.STM);
