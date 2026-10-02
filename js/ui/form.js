/* 추가/수정 폼 (PRD F2-1, F2-2) */
(function (STM) {
  'use strict';

  const { el, isDateStr, safeUrl } = STM.utils;
  const C = STM.constants;

  function field(name, label, control, required) {
    const error = el('p', { class: 'field-error', id: `err-${name}` });
    control.id = `f-${name}`;
    control.name = name;
    control.setAttribute('aria-describedby', error.id);
    if (required) control.setAttribute('aria-required', 'true');
    const wrap = el('div', { class: 'field' }, [
      el('label', { for: control.id }, [label, required ? el('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null]),
      control,
      error,
    ]);
    return { wrap, control, error };
  }

  function select(options, value, emptyLabel) {
    const opts = emptyLabel !== undefined ? [el('option', { value: '' }, emptyLabel)] : [];
    return el('select', null, opts.concat(options.map((o) => el('option', { value: o, selected: o === value }, o))));
  }

  function validate(d) {
    const errors = {};
    if (!d.docNo) errors.docNo = '문서번호를 입력하세요.';
    if (!C.TYPES.includes(d.type)) errors.type = '구분을 선택하세요.';
    if (!d.title) errors.title = '제목을 입력하세요.';
    if (!isDateStr(d.date)) errors.date = '공개일/선고일을 입력하세요.';
    if (!C.CATEGORIES.includes(d.category)) errors.category = '세목을 선택하세요.';
    if (d.url && !safeUrl(d.url)) errors.url = 'http:// 또는 https:// 로 시작하는 주소를 입력하세요.';
    return errors;
  }

  // ruling이 없으면 추가, 있으면 수정. onSubmit이 code가 있는 에러를 던지면 문서번호 칸에 표시한다.
  function render(ruling, h) {
    const v = ruling || {};
    const f = {
      docNo: field('docNo', '문서번호', el('input', { type: 'text', maxlength: '100', placeholder: '예: 서면-2026-법인-1234', value: v.docNo || '' }), true),
      type: field('type', '구분', select(C.TYPES, v.type || '예규'), true),
      title: field('title', '제목', el('input', { type: 'text', maxlength: '300', value: v.title || '' }), true),
      date: field('date', '공개일/선고일', el('input', { type: 'date', value: v.date || '' }), true),
      issuer: field('issuer', '발행기관', el('input', { type: 'text', maxlength: '100', placeholder: '예: 국세청, 기획재정부, 조세심판원, 대법원', value: v.issuer || '' })),
      category: field('category', '세목', select(C.CATEGORIES, v.category || '', '선택하세요'), true),
      relevance: field('relevance', '관련도', select(C.RELEVANCE, v.relevance || '', '미정')),
      url: field('url', '원문 링크', el('input', { type: 'url', maxlength: '2000', placeholder: 'https://', value: v.url || '' })),
      summary: field('summary', '요지', el('textarea', { rows: '6', maxlength: '5000', value: v.summary || '' })),
    };

    // 부 세목: 주 세목과 같은 값은 저장 시 제외한다 (PRD F4-3)
    const subChecks = C.CATEGORIES.map((c) => el('input', { type: 'checkbox', value: c, checked: (v.subCategories || []).includes(c) }));
    const subField = el('fieldset', { class: 'field sub-categories' }, [
      el('legend', null, '부 세목 (여러 세목에 걸치는 경우)'),
      el(
        'div',
        { class: 'check-row' },
        subChecks.map((input) => el('label', null, [input, ' ', input.value]))
      ),
    ]);

    const submitBtn = el('button', { type: 'submit', class: 'btn-primary' }, ruling ? '저장' : '추가');

    function readData() {
      const category = f.category.control.value;
      return {
        subCategories: subChecks.filter((c) => c.checked && c.value !== category).map((c) => c.value),
        docNo: f.docNo.control.value.trim(),
        type: f.type.control.value,
        title: f.title.control.value.trim(),
        date: f.date.control.value,
        issuer: f.issuer.control.value.trim(),
        category: f.category.control.value,
        relevance: f.relevance.control.value || null,
        url: f.url.control.value.trim(),
        summary: f.summary.control.value.trim(),
      };
    }

    function showErrors(errors) {
      let first = null;
      for (const key of Object.keys(f)) {
        const msg = errors[key] || '';
        f[key].error.textContent = msg;
        f[key].control.setAttribute('aria-invalid', msg ? 'true' : 'false');
        if (msg && !first) first = f[key].control;
      }
      if (first) first.focus();
    }

    async function onSubmit(e) {
      e.preventDefault();
      if (submitBtn.disabled) return;
      const data = readData();
      const errors = validate(data);
      showErrors(errors);
      if (Object.keys(errors).length) return;

      submitBtn.disabled = true;
      try {
        await h.onSubmit(data);
      } catch (err) {
        if (err && err.code) showErrors({ docNo: err.message });
        else STM.utils.toast(err && err.message ? err.message : '저장하지 못했습니다.', 'error');
      } finally {
        submitBtn.disabled = false;
      }
    }

    return el('form', { class: 'form', novalidate: true, onsubmit: onSubmit }, [
      el('h2', null, ruling ? '예규/판례 수정' : '예규/판례 추가'),
      el('div', { class: 'form-grid' }, [f.docNo.wrap, f.type.wrap, f.date.wrap, f.category.wrap, f.issuer.wrap, f.relevance.wrap]),
      subField,
      f.title.wrap,
      f.url.wrap,
      f.summary.wrap,
      el('p', { class: 'help confidential' }, C.CONFIDENTIAL_NOTICE),
      el('div', { class: 'detail-actions' }, [submitBtn, el('button', { type: 'button', onclick: h.onCancel }, '취소')]),
    ]);
  }

  // 분석 결과 직접 편집: 한 줄에 한 항목 (PRD F3 담당자 편집)
  function renderAnalysis(ruling, h) {
    const a = ruling.analysis || C.emptyAnalysis();
    const area = (name, label, lines, hint) =>
      field(name, label, el('textarea', { rows: '6', maxlength: '10000', placeholder: hint, value: lines.join('\n') }));
    const f = {
      implications: area('implications', '① 시사점 (철강회사 관점)', a.implications, '한 줄에 하나씩 입력'),
      reviewItems: area('reviewItems', '② 세무담당자 검토사항', a.reviewItems.map((it) => it.text), '한 줄에 하나씩 입력'),
      relatedRefs: area('relatedRefs', '③ 관련 예규/판례 번호', a.relatedRefs, '예: 서면-2026-법인-1234'),
    };
    const lines = (key) =>
      f[key].control.value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

    const submitBtn = el('button', { type: 'submit', class: 'btn-primary' }, '저장');
    async function onSubmit(e) {
      e.preventDefault();
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
      try {
        await h.onSubmit({ implications: lines('implications'), reviewItems: lines('reviewItems'), relatedRefs: lines('relatedRefs') });
      } catch (err) {
        STM.utils.toast(err && err.message ? err.message : '저장하지 못했습니다.', 'error');
      } finally {
        submitBtn.disabled = false;
      }
    }

    return el('form', { class: 'form', novalidate: true, onsubmit: onSubmit }, [
      el('h2', null, '분석 결과 편집'),
      el('p', { class: 'detail-dates' }, `${ruling.docNo} · ${ruling.title}`),
      f.implications.wrap,
      f.reviewItems.wrap,
      f.relatedRefs.wrap,
      el('div', { class: 'detail-actions' }, [submitBtn, el('button', { type: 'button', onclick: h.onCancel }, '취소')]),
    ]);
  }

  STM.ui.form = { render, renderAnalysis };
})(window.STM);
