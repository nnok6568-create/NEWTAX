/* 수집·붙여넣기 등록 화면: 입력, 진행 상태, 미리보기 후 선택 등록 (PRD F1-3, F1-4) */
(function (STM) {
  'use strict';

  const { el } = STM.utils;
  const { badge } = STM.ui.list;

  const PASTE_HELP = '엑셀에서 복사해 붙여넣거나 CSV를 붙여넣으세요. 첫 줄이 헤더(문서번호, 구분, 제목, 날짜, 기관, 요지, 링크, 세목)이면 열 순서는 자유이며, 헤더가 없으면 이 순서로 읽습니다. 세목이 없으면 키워드로 추정한 뒤 AI 분석 때 보정합니다.';

  function renderPasteInput(initialText, h) {
    const textarea = el('textarea', {
      id: 'paste-input',
      rows: '12',
      'aria-label': '붙여넣을 내용',
      placeholder: '문서번호\t구분\t제목\t날짜\t기관\t요지\t링크\t세목\n서면-2026-법인-1234\t예규\t…\t2026-09-25\t국세청\t…',
      value: initialText || '',
    });
    return el(
      'form',
      {
        class: 'form',
        onsubmit: (e) => {
          e.preventDefault();
          h.onPreview(textarea.value);
        },
      },
      [
        el('h2', null, '붙여넣기 등록'),
        el('p', { class: 'help' }, PASTE_HELP),
        el('p', { class: 'help confidential' }, STM.constants.CONFIDENTIAL_NOTICE),
        textarea,
        el('div', { class: 'detail-actions' }, [
          el('button', { type: 'submit', class: 'btn-primary' }, '미리보기'),
          el('button', { type: 'button', onclick: h.onCancel }, '취소'),
        ]),
      ]
    );
  }

  function renderProgress(title, message) {
    return el('div', { class: 'progress-view' }, [el('h2', null, title), el('p', { class: 'spinner-text', role: 'status', id: 'progress-text' }, message)]);
  }

  function renderMessage(title, message, actions) {
    return el('div', null, [
      el('h2', null, title),
      el('p', { class: 'message-text' }, message),
      el(
        'div',
        { class: 'detail-actions' },
        actions.map((a) => el('button', { type: 'button', class: a.primary ? 'btn-primary' : null, onclick: a.onClick }, a.label))
      ),
    ]);
  }

  // items: [{ data, exists }] / errors: [{ line, error }] / notes: string[]
  function renderPreview(opts, h) {
    const { title, items, errors, notes, warnings } = opts;
    const fresh = items.filter((it) => !it.exists);
    const checks = new Map();
    const submitBtn = el('button', { type: 'button', class: 'btn-primary' });
    const updateCount = () => {
      const n = Array.from(checks.values()).filter((c) => c.checked).length;
      submitBtn.textContent = `선택 등록 (${n}건)`;
      submitBtn.disabled = n === 0;
    };

    const rows = items.map((it) => {
      const d = it.data;
      let control;
      if (it.exists) control = el('span', { class: 'badge badge-existing' }, '기존');
      else {
        control = el('input', { type: 'checkbox', checked: true, 'aria-label': `${d.docNo} 등록`, onchange: updateCount });
        checks.set(it, control);
      }
      return el('li', { class: 'preview-row' + (it.exists ? ' is-existing' : '') }, [
        el('div', { class: 'preview-select' }, control),
        el('div', { class: 'preview-info' }, [
          el('div', { class: 'card-badges' }, [badge(d.category, 'category', d.category), badge(d.type, 'type')]),
          STM.ui.list.docMeta(d),
          el('p', { class: 'preview-title' }, d.title),
        ]),
      ]);
    });

    submitBtn.addEventListener('click', () => {
      const selected = items.filter((it) => checks.has(it) && checks.get(it).checked).map((it) => it.data);
      if (selected.length) h.onConfirm(selected);
    });
    updateCount();

    return el('div', { class: 'preview' }, [
      el('h2', null, title),
      el('p', { class: 'preview-summary' }, `신규 ${fresh.length}건 · 기존 ${items.length - fresh.length}건${errors.length ? ` · 오류 ${errors.length}건` : ''}`),
      ...(warnings || []).map((w) => el('p', { class: 'preview-warning', role: 'alert' }, w)),
      ...(notes || []).map((n) => el('p', { class: 'help' }, n)),
      items.length ? el('ul', { class: 'preview-list' }, rows) : el('p', { class: 'placeholder' }, '등록할 항목이 없습니다.'),
      errors.length
        ? el('details', { class: 'preview-errors', open: true }, [
            el('summary', null, `등록할 수 없는 줄 ${errors.length}건`),
            el('ul', null, errors.map((e) => el('li', null, `${e.line}번째 줄: ${e.error}`))),
          ])
        : null,
      el('div', { class: 'detail-actions' }, [
        h.onBack ? el('button', { type: 'button', onclick: h.onBack }, '← 다시 입력') : null,
        submitBtn,
        el('button', { type: 'button', onclick: h.onCancel }, '취소'),
      ]),
    ]);
  }

  STM.ui.importPreview = { renderPasteInput, renderProgress, renderMessage, renderPreview };
})(window.STM);
