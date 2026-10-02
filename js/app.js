/* 진입점: 상태 관리, 화면 전환, 모달, 이벤트 연결 */
(function (STM) {
  'use strict';

  const { el, toast, formatDateTime, todayStr, addDays } = STM.utils;
  const C = STM.constants;
  const db = STM.db;
  const UI = STM.ui;

  const state = {
    rulings: [],
    trash: [],
    activeCategory: C.ALL,
    view: 'list',
    persisted: false,
    filters: Object.assign({}, UI.list.EMPTY_FILTERS),
    selected: new Set(),
    batch: { running: false, done: 0, total: 0 },
    analyzing: new Set(), // 분석 중인 id
    fatal: null,
    error: null, // { title, message, actions }: 닫을 수 있는 오류 배너
    backupReminderDismissed: false,
  };

  const $ = (id) => document.getElementById(id);

  // ---------- 모달 ----------
  const modal = { open: false, onClose: null, lastFocus: null, detailId: null, seq: 0 };

  function openModal(content, opts) {
    const o = opts || {};
    const lastFocus = modal.open ? modal.lastFocus : document.activeElement;
    closeModal({ keepFocus: true });
    modal.lastFocus = lastFocus;
    const variant = o.variant || 'default';
    const dialog = el(
      'div',
      { class: `modal modal-${variant}${o.noAnim ? ' no-anim' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': o.label || '', tabindex: '-1' },
      content
    );
    // 카드를 더블클릭했을 때 두 번째 클릭이 바깥 영역을 눌러 바로 닫히지 않게, 열린 직후 잠깐은 무시한다.
    const openedAt = Date.now();
    const overlay = el(
      'div',
      { class: `modal-overlay overlay-${variant}`, onmousedown: (e) => e.target === overlay && Date.now() - openedAt > 400 && closeModal() },
      dialog
    );
    $('modal-root').replaceChildren(overlay);
    document.body.classList.add('has-modal');
    modal.open = true;
    modal.onClose = o.onClose || null;
    modal.detailId = o.detailId || null;
    modal.seq++;
    const firstInput = dialog.querySelector('input, select, textarea');
    (o.focusFirstInput && firstInput ? firstInput : dialog).focus();
    return modal.seq;
  }

  function closeModal(opts) {
    if (!modal.open) return;
    const cb = modal.onClose;
    modal.open = false;
    modal.onClose = null;
    modal.detailId = null;
    modal.seq++;
    $('modal-root').replaceChildren();
    document.body.classList.remove('has-modal');
    if (cb) cb();
    if (!(opts && opts.keepFocus) && modal.lastFocus && modal.lastFocus.isConnected) modal.lastFocus.focus();
  }

  // ---------- 데이터 ----------
  async function reload() {
    const all = await db.getAllRaw();
    state.rulings = all.filter((r) => !r.deletedAt);
    state.trash = all.filter((r) => r.deletedAt);
    const ids = new Set(state.rulings.map((r) => r.id));
    for (const id of state.selected) if (!ids.has(id)) state.selected.delete(id);
  }

  function replaceInState(saved) {
    const i = state.rulings.findIndex((r) => r.id === saved.id);
    if (i >= 0) state.rulings[i] = saved;
  }

  function findRuling(id) {
    return state.rulings.find((r) => r.id === id) || null;
  }

  // 휴지통 포함 전체 문서번호의 정규화 키 (C.docNoKey)
  function allDocNoKeys() {
    return new Set(state.rulings.concat(state.trash).map((r) => C.docNoKey(r.docNo)));
  }

  // 표기만 다른 같은 문서번호(공백·하이픈 차이 등)를 찾는다. DB의 unique 인덱스는 정확히 같은 값만 막는다.
  function findSameDocNo(docNo, selfId) {
    const key = C.docNoKey(docNo);
    return state.rulings.concat(state.trash).find((r) => r.id !== selfId && C.docNoKey(r.docNo) === key) || null;
  }

  function errorMessage(err, fallback) {
    return (err && err.message) || fallback;
  }

  // 원인과 해결 방법을 빨간 배너로 보여준다. 키·설정 문제면 [설정 열기]를 붙인다.
  function showError(title, err, fallback) {
    const code = (err && err.code) || '';
    const actions = [];
    if (code === 'NO_KEY' || code === 'CORS' || /^HTTP_40[134]$/.test(code)) {
      actions.push({
        label: '설정 열기',
        onClick: () => {
          closeModal();
          setView('settings');
        },
      });
    }
    state.error = { title, message: errorMessage(err, fallback || '알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도하세요.'), actions };
    renderBanner();
    // 패널·모달이 배너를 가리고 있으면 토스트로도 알린다 (배너는 닫은 뒤에도 남아 있다).
    if (modal.open) toast(`${title}: ${state.error.message}`, 'error');
  }

  // 저장에 성공하면 true를 돌려준다.
  async function saveFields(id, patch, opts) {
    try {
      replaceInState(await db.update(id, patch));
      renderMain();
      if (opts && opts.refreshDetail) refreshDetailIfOpen(id);
      return true;
    } catch (err) {
      showError('저장하지 못했습니다', err, '잠시 후 다시 시도하세요. 계속되면 새로고침하세요.');
      return false;
    }
  }

  // ---------- 메모 초안 ----------
  // 메모는 디바운스 후 IndexedDB에 저장되는데, 그 사이 페이지를 닫으면 비동기 저장이 끝나지 않는다.
  // 그래서 입력할 때마다 localStorage에 동기로 초안을 남기고, 저장되면 지운다. 다음 시작 때 남은 초안을 반영한다.
  const MEMO_DRAFT_KEY = 'stm.memoDraft';

  function writeMemoDraft(id, memo) {
    try {
      localStorage.setItem(MEMO_DRAFT_KEY, JSON.stringify({ id, memo, at: new Date().toISOString() }));
    } catch (e) {
      /* 저장 불가 환경: IndexedDB 저장만 시도한다 */
    }
  }

  function readMemoDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(MEMO_DRAFT_KEY) || 'null');
      return d && typeof d.id === 'string' && typeof d.memo === 'string' ? d : null;
    } catch (e) {
      return null;
    }
  }

  function clearMemoDraft(id, memo) {
    const d = readMemoDraft();
    if (!d || (d.id === id && d.memo === memo)) {
      try {
        localStorage.removeItem(MEMO_DRAFT_KEY);
      } catch (e) {
        /* 무시 */
      }
    }
  }

  async function saveMemo(id, memo) {
    if (await saveFields(id, { memo })) clearMemoDraft(id, memo);
  }

  // 초안보다 나중에 수정된 레코드에는 반영하지 않는다.
  async function recoverMemoDraft() {
    const d = readMemoDraft();
    if (!d) return;
    const r = findRuling(d.id);
    try {
      if (r && r.memo !== d.memo && !(r.updatedAt > d.at)) {
        replaceInState(await db.update(d.id, { memo: d.memo }));
        toast(`"${r.docNo}"의 저장되지 않았던 메모를 복구했습니다.`);
      }
      clearMemoDraft(d.id, d.memo);
    } catch (err) {
      showError('메모 초안을 복구하지 못했습니다', err); // 초안은 남겨 두어 다음 시작 때 다시 시도한다
    }
  }

  // 같은 문서번호가 이미 있으면(휴지통 포함) 저장을 막는다 (PRD F1-4, F2-1).
  async function assertDocNoAvailable(docNo, selfId) {
    const exact = await db.getByDocNo(docNo);
    // 수정 시 정규화 키가 그대로면 표기 중복 검사는 하지 않는다. 정규화 도입 전에 따로 저장된
    // 표기만 다른 두 건이 있어도, 문서번호를 건드리지 않은 수정까지 막지는 않는다.
    const self = selfId ? state.rulings.concat(state.trash).find((r) => r.id === selfId) : null;
    const keyUnchanged = !!self && C.docNoKey(self.docNo) === C.docNoKey(docNo);
    const dup = exact && exact.id !== selfId ? exact : keyUnchanged ? null : findSameDocNo(docNo, selfId);
    if (!dup) return;
    const same = dup.docNo === docNo ? '같은 문서번호' : `같은 문서번호(${dup.docNo})`;
    const err = new Error(
      dup.deletedAt ? `휴지통에 ${same}가 있습니다. 설정 > 휴지통에서 복원하거나 영구 삭제하세요.` : `이미 ${same}가 등록되어 있습니다.`
    );
    err.code = 'DUPLICATE';
    throw err;
  }

  async function insertSamples() {
    let added = 0;
    try {
      for (const sample of STM.samples.build()) {
        if (await db.getByDocNo(sample.docNo)) continue;
        await db.add(C.createRuling(Object.assign({}, sample, { analysis: sample.analysis || C.emptyAnalysis() })));
        added++;
      }
      await reload();
      renderMain();
      toast(added ? `샘플 데이터 ${added}건을 넣었습니다.` : '샘플 데이터가 이미 있습니다.');
    } catch (err) {
      toast(errorMessage(err, '샘플 데이터를 넣지 못했습니다.'), 'error');
    }
  }

  // ---------- AI 분석 (PRD F3) ----------
  async function analyzeAndSave(id) {
    const r = findRuling(id);
    if (!r) throw new Error('삭제된 항목입니다.');
    const result = await STM.ai.analyze(r);
    const saved = await db.update(id, (cur) => STM.ai.analysisChanges(cur, result));
    replaceInState(saved);
    return saved;
  }

  async function analyzeOne(id) {
    if (state.analyzing.has(id)) return;
    state.analyzing.add(id);
    refreshDetailIfOpen(id);
    try {
      await analyzeAndSave(id);
      toast('AI 분석을 마쳤습니다.');
    } catch (err) {
      showError('AI 분석에 실패했습니다', err);
    } finally {
      state.analyzing.delete(id);
      renderMain();
      refreshDetailIfOpen(id);
    }
  }

  // 선택한 건 중 아직 분석되지 않은 건만 동시 2건씩 분석한다 (PRD F3-5, F3-7).
  async function analyzeSelected() {
    if (state.batch.running) return;
    const ids = Array.from(state.selected).filter((id) => findRuling(id));
    const todo = ids.filter((id) => !C.hasAnalysis(findRuling(id).analysis));
    if (!todo.length) {
      toast('선택한 건은 모두 분석되어 있습니다. 다시 분석하려면 상세 화면에서 [재분석]을 누르세요.');
      return;
    }
    if (!STM.settings.get('apiKey')) {
      toast('Claude API 키가 없습니다. 설정에서 입력하세요.', 'error');
      return;
    }
    const skipped = ids.length - todo.length;
    state.batch = { running: true, done: 0, total: todo.length };
    renderMain();

    const results = await STM.ai.runPool(
      todo,
      2,
      async (id) => {
        state.analyzing.add(id);
        try {
          return await analyzeAndSave(id);
        } finally {
          state.analyzing.delete(id);
          refreshDetailIfOpen(id);
        }
      },
      (done) => {
        state.batch.done = done;
        renderMain();
      }
    );

    state.batch = { running: false, done: 0, total: 0 };
    const failed = results.filter((r) => !r.ok);
    // 실패한 건만 선택 상태로 남겨 바로 다시 시도할 수 있게 한다.
    state.selected = new Set(todo.filter((id, i) => !results[i].ok));
    renderMain();
    const parts = [`성공 ${results.length - failed.length}건`];
    if (failed.length) parts.push(`실패 ${failed.length}건`);
    if (skipped) parts.push(`이미 분석된 ${skipped}건 건너뜀`);
    if (failed.length) {
      showError(`일괄 분석 중 ${failed.length}건이 실패했습니다 (${parts.join(', ')})`, failed[0].error);
      toast('실패한 건은 선택된 채로 두었습니다. 원인을 해결한 뒤 [선택 분석]을 다시 누르세요.');
    } else {
      toast(`일괄 분석 완료: ${parts.join(', ')}`);
    }
  }

  // 새로 등록된 건의 관련도·세목을 AI로 1차 판정한다 (PRD F1-5). 담당자가 정한 값은 바꾸지 않는다.
  async function judgeNewRecords(records) {
    if (!records.length || !STM.settings.get('apiKey')) return;
    toast(`AI가 ${records.length}건의 관련도를 판정하는 중입니다…`);
    try {
      const judged = await STM.ai.judgeRelevance(records);
      for (const [i, v] of judged) {
        await db.update(records[i].id, (cur) => {
          const changes = {};
          if (v.relevance && !C.isRelevanceByUser(cur)) changes.relevance = v.relevance;
          if (v.category && !C.isCategoryByUser(cur)) changes.category = v.category;
          return changes;
        });
      }
      await reload();
      renderMain();
      toast(`관련도 판정을 마쳤습니다 (${judged.size}건).`);
    } catch (err) {
      showError('관련도 판정에 실패했습니다 (등록은 완료됨)', err);
    }
  }

  // ---------- 수집·붙여넣기 (PRD F1) ----------
  async function registerCandidates(datas) {
    const added = [];
    const known = allDocNoKeys();
    try {
      for (const d of datas) {
        const key = C.docNoKey(d.docNo);
        if (known.has(key) || (await db.getByDocNo(d.docNo))) continue;
        const r = C.createRuling(d);
        await db.add(r);
        known.add(key);
        added.push(r);
      }
    } catch (err) {
      toast(errorMessage(err, '등록하지 못했습니다.'), 'error');
    }
    await reload();
    renderMain();
    closeModal();
    toast(`${added.length}건을 등록했습니다.${added.length < datas.length ? ` (중복 ${datas.length - added.length}건 제외)` : ''}`);
    judgeNewRecords(added);
  }

  async function startCollect() {
    const days = Number(STM.settings.get('periodDays')) || 7;
    const P = UI.importPreview;
    const seq = openModal(P.renderProgress(`최근 ${days}일 예규/판례 수집`, '준비 중…'), { label: '수집' });
    const known = allDocNoKeys();
    try {
      const result = await STM.collector.collect(known, (msg) => {
        const p = $('progress-text');
        if (p && modal.seq === seq) p.textContent = msg;
      });
      STM.settings.set({ lastFetchedAt: new Date().toISOString() });
      renderMain();
      if (modal.seq !== seq) {
        toast(`수집이 끝났습니다 (${result.candidates.length}건). 다시 [수집]을 눌러 결과를 확인하세요.`);
        return;
      }
      const items = result.candidates.map((d) => ({ data: d, exists: known.has(C.docNoKey(d.docNo)) }));
      const notes = [`${result.from} ~ ${result.to} 사이 공개·선고된 조세 관련 판례·법령해석례입니다. 국세청 예규·조세심판원 결정은 [붙여넣기 등록]을 이용하세요.`].concat(
        result.errors.map((e) => '일부 실패 — ' + e)
      );
      openModal(P.renderPreview({ title: '수집 결과', items, errors: [], notes, warnings: result.warnings }, { onConfirm: registerCandidates, onCancel: closeModal }), { label: '수집 결과' });
    } catch (err) {
      if (modal.seq !== seq) {
        toast(errorMessage(err, '수집하지 못했습니다.'), 'error');
        return;
      }
      const actions = [{ label: '붙여넣기 등록', primary: true, onClick: openPaste }];
      if (err.code === 'NO_KEY' || err.code === 'CORS') {
        actions.push({
          label: '설정 열기',
          onClick: () => {
            closeModal();
            setView('settings');
          },
        });
      }
      actions.push({ label: '닫기', onClick: closeModal });
      openModal(P.renderMessage('수집하지 못했습니다', errorMessage(err, '알 수 없는 오류'), actions), { label: '수집 실패' });
    }
  }

  let pasteDraft = '';

  function openPaste() {
    openModal(
      UI.importPreview.renderPasteInput(pasteDraft, {
        onPreview: (text) => {
          pasteDraft = text;
          previewPaste(text);
        },
        onCancel: closeModal,
      }),
      { label: '붙여넣기 등록', focusFirstInput: true }
    );
  }

  function previewPaste(text) {
    const { rows } = STM.importer.parse(text);
    if (!rows.length) {
      toast('붙여넣은 내용이 없습니다.', 'error');
      return;
    }
    const known = allDocNoKeys();
    const items = rows.filter((r) => r.data).map((r) => ({ data: r.data, exists: known.has(C.docNoKey(r.data.docNo)) }));
    const errors = rows.filter((r) => r.error);
    openModal(
      UI.importPreview.renderPreview(
        { title: '붙여넣기 미리보기', items, errors, notes: [] },
        {
          onConfirm: async (datas) => {
            pasteDraft = '';
            await registerCandidates(datas);
          },
          onBack: openPaste,
          onCancel: closeModal,
        }
      ),
      { label: '붙여넣기 미리보기' }
    );
  }

  // ---------- 백업 (PRD F6) ----------
  const backupHandlers = {
    onExportJson: async () => {
      try {
        const n = await STM.backup.exportJson();
        toast(`${n}건을 JSON으로 백업했습니다.`);
        renderMain();
      } catch (err) {
        toast(errorMessage(err, '백업하지 못했습니다.'), 'error');
      }
    },
    onExportCsv: () => {
      const n = STM.backup.exportCsv(UI.list.visibleRulings(state));
      toast(`${n}건을 CSV로 내보냈습니다.`);
    },
    onImportJson: async (file, mode) => {
      if (mode === 'overwrite') {
        const total = state.rulings.length + state.trash.length;
        if (!window.confirm(`현재 데이터 ${total}건(휴지통 포함)을 모두 지우고 백업 파일 내용으로 바꿉니다. 계속할까요?`)) return;
      }
      try {
        const res = await STM.backup.importJson(file, mode);
        await reload();
        renderMain();
        closeModal();
        toast(
          `가져오기 완료: 추가 ${res.added}건, 갱신 ${res.updated}건, 건너뜀 ${res.skipped}건${res.invalid ? `, 잘못된 항목 ${res.invalid}건 제외` : ''}` +
            (res.variants ? `. 표기만 다른 문서번호가 ${res.variants}건 있습니다. 같은 문서인지 확인하세요.` : '')
        );
      } catch (err) {
        toast(errorMessage(err, '가져오지 못했습니다.'), 'error');
      }
    },
  };

  function openBackup() {
    const info = { lastBackupAt: STM.settings.get('lastBackupAt'), csvCount: UI.list.visibleRulings(state).length };
    openModal(
      el('div', null, [
        el('h2', null, '내보내기 · 백업'),
        UI.settings.renderBackupPanel(info, backupHandlers),
        el('div', { class: 'detail-actions' }, [el('button', { type: 'button', onclick: closeModal }, '닫기')]),
      ]),
      { label: '내보내기 · 백업' }
    );
  }

  // ---------- 상세 / 폼 ----------
  function refreshDetailIfOpen(id) {
    if (modal.open && modal.detailId === id) openDetail(id);
  }

  function openDetail(id) {
    // 이미 열린 같은 건을 다시 그릴 때는 슬라이드 애니메이션을 생략한다.
    const reopen = modal.open && modal.detailId === id;
    const r = findRuling(id);
    if (!r) return;
    const view = UI.detail.render(r, {
      knownDocNos: new Set(state.rulings.map((x) => C.docNoKey(x.docNo))),
      variantDocNos: state.rulings
        .concat(state.trash)
        .filter((x) => x.id !== id && C.docNoKey(x.docNo) === C.docNoKey(r.docNo))
        .map((x) => (x.deletedAt ? `${x.docNo}(휴지통)` : x.docNo)),
      analyzing: state.analyzing.has(id),
      onStatusChange: (status) => saveFields(id, { status }),
      onMemoInput: (memo) => writeMemoDraft(id, memo),
      onMemoChange: (memo) => saveMemo(id, memo),
      onToggleReview: (index, checked) =>
        saveFields(id, (cur) => ({
          analysis: Object.assign({}, cur.analysis, {
            reviewItems: cur.analysis.reviewItems.map((it, i) => (i === index ? Object.assign({}, it, { checked }) : it)),
          }),
        })),
      onAnalyze: () => analyzeOne(id),
      onEditAnalysis: () => openAnalysisForm(id),
      onRevertAnalysis: () => saveFields(id, (cur) => ({ analysis: cur.prevAnalysis, prevAnalysis: cur.analysis }), { refreshDetail: true }),
      onApplySuggestion: (patch) =>
        saveFields(
          id,
          (cur) => {
            const changes = { analysis: Object.assign({}, cur.analysis) };
            if (patch.category) {
              changes.category = patch.category;
              changes.categoryByUser = true;
              changes.subCategories = (cur.subCategories || []).filter((c) => c !== patch.category);
              changes.analysis.suggestedCategory = null;
            }
            if (patch.relevance) {
              changes.relevance = patch.relevance;
              changes.relevanceByUser = true;
              changes.analysis.suggestedRelevance = null;
            }
            return changes;
          },
          { refreshDetail: true }
        ),
      onEdit: () => openForm(id),
      onDelete: () => deleteRuling(id),
      onClose: closeModal,
    });
    openModal(view.node, { label: '예규/판례 상세', variant: 'panel', onClose: view.flush, detailId: id, noAnim: reopen });
  }

  function openForm(id) {
    const existing = id ? findRuling(id) : null;
    const node = UI.form.render(existing, {
      onSubmit: async (data) => {
        await assertDocNoAvailable(data.docNo, existing && existing.id);
        const fields = Object.assign({}, data, { categoryByUser: true, relevanceByUser: data.relevance !== null });
        const saved = existing
          ? await db.update(existing.id, Object.assign(fields, { editedByUser: true }))
          : await db.add(C.createRuling(Object.assign(fields, { source: 'manual' })));
        await reload();
        renderMain();
        toast(existing ? '수정했습니다.' : '추가했습니다.');
        openDetail(saved.id);
      },
      onCancel: () => (existing ? openDetail(existing.id) : closeModal()),
    });
    openModal(node, { label: existing ? '예규/판례 수정' : '예규/판례 추가', focusFirstInput: true });
  }

  function openAnalysisForm(id) {
    const r = findRuling(id);
    if (!r) return;
    const node = UI.form.renderAnalysis(r, {
      onSubmit: async (data) => {
        const saved = await db.update(id, (cur) => {
          const checked = new Map(cur.analysis.reviewItems.map((it) => [it.text, it.checked]));
          return {
            editedByUser: true,
            analysis: Object.assign({}, cur.analysis, {
              implications: data.implications,
              reviewItems: data.reviewItems.map((text) => ({ text, checked: checked.get(text) === true })),
              relatedRefs: data.relatedRefs,
              editedAt: new Date().toISOString(),
            }),
          };
        });
        replaceInState(saved);
        renderMain();
        toast('분석 결과를 저장했습니다.');
        openDetail(id);
      },
      onCancel: () => openDetail(id),
    });
    openModal(node, { label: '분석 결과 편집', focusFirstInput: true });
  }

  async function deleteRuling(id) {
    const r = findRuling(id);
    if (!r) return;
    if (!window.confirm(`"${r.docNo}" 건을 삭제할까요?\n휴지통으로 이동하며 ${C.TRASH_RETENTION_DAYS}일 안에 복원할 수 있습니다.`)) return;
    closeModal();
    try {
      await db.softDelete(id);
      state.selected.delete(id);
      await reload();
      renderMain();
      toast(`"${r.docNo}" 건을 휴지통으로 옮겼습니다.`, 'info', { label: '되돌리기', onClick: () => restoreRuling(id) });
    } catch (err) {
      showError('삭제하지 못했습니다', err);
    }
  }

  async function restoreRuling(id) {
    try {
      await db.restore(id);
      await reload();
      renderMain();
      toast('복원했습니다.');
    } catch (err) {
      toast(errorMessage(err, '복원하지 못했습니다.'), 'error');
    }
  }

  async function hardDeleteRuling(r) {
    if (!window.confirm(`"${r.docNo}" 건을 영구 삭제할까요?\n되돌릴 수 없습니다.`)) return;
    try {
      await db.hardDelete(r.id);
      await reload();
      renderMain();
      toast('영구 삭제했습니다.');
    } catch (err) {
      toast(errorMessage(err, '삭제하지 못했습니다.'), 'error');
    }
  }

  // ---------- 화면 테마 ----------
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function effectiveTheme() {
    const t = STM.settings.get('theme');
    return t === 'light' || t === 'dark' ? t : darkQuery.matches ? 'dark' : 'light';
  }

  // 'system'이면 data-theme을 지워 OS 설정을 따른다.
  function applyTheme(theme) {
    if (theme) STM.settings.set({ theme });
    const t = STM.settings.get('theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    const dark = effectiveTheme() === 'dark';
    const label = `${dark ? '라이트' : '다크'} 모드로 전환`;
    const btn = $('btn-theme');
    btn.textContent = dark ? '☀' : '☾';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  // ---------- 설정 ----------
  const settingsHandlers = Object.assign({}, backupHandlers, {
    onThemeChange: (theme) => {
      applyTheme(theme);
      toast(theme === 'system' ? '화면 모드가 시스템 설정을 따릅니다.' : `${theme === 'dark' ? '다크' : '라이트'} 모드로 바꿨습니다.`);
    },
    onBack: () => setView('list'),
    onSample: insertSamples,
    onRestore: restoreRuling,
    onHardDelete: hardDeleteRuling,
    onSaveAi: ({ apiKey, model }) => {
      const patch = { model: model || STM.settings.DEFAULTS.model };
      if (apiKey) patch.apiKey = apiKey;
      const ok = STM.settings.set(patch);
      toast(ok ? 'AI 설정을 저장했습니다.' : '설정을 브라우저에 저장하지 못했습니다. 이번 사용 중에만 유지됩니다.', ok ? 'info' : 'error');
      renderMain();
    },
    onDeleteKey: () => {
      if (!window.confirm('저장된 Claude API 키를 이 브라우저에서 삭제할까요?')) return;
      STM.settings.set({ apiKey: '' });
      toast('API 키를 삭제했습니다.');
      renderMain();
    },
    onTestAi: async () => {
      try {
        await STM.ai.testConnection();
        toast('Claude API 연결에 성공했습니다.');
      } catch (err) {
        toast(errorMessage(err, '연결에 실패했습니다.'), 'error');
      }
    },
    onSaveCollect: ({ lawApiKey, periodDays, proxyUrl }) => {
      if (!Number.isInteger(periodDays) || periodDays < 1 || periodDays > 90) {
        toast('수집 기간은 1~90 사이의 정수로 입력하세요.', 'error');
        return;
      }
      if (proxyUrl && !STM.utils.safeUrl(proxyUrl.replace('{url}', ''))) {
        toast('프록시 URL은 http:// 또는 https:// 로 시작해야 합니다.', 'error');
        return;
      }
      STM.settings.set({ lawApiKey, periodDays, proxyUrl });
      toast('수집 설정을 저장했습니다.');
      renderMain();
    },
  });

  // ---------- 렌더링 ----------
  function setView(view) {
    state.view = view;
    $('btn-settings').setAttribute('aria-pressed', String(view === 'settings'));
    renderMain();
    window.scrollTo(0, 0);
  }

  const listHandlers = {
    onTabChange: (cat) => {
      state.activeCategory = cat;
      renderMain();
    },
    onFilterChange: (patch) => {
      Object.assign(state.filters, patch);
      renderMain();
    },
    onRecent: () => {
      const today = todayStr();
      Object.assign(state.filters, { from: addDays(today, -(Number(STM.settings.get('periodDays')) || 7)), to: today });
      renderMain();
    },
    onSelect: (id, checked) => {
      checked ? state.selected.add(id) : state.selected.delete(id);
      renderMain();
    },
    onSelectAll: (ids) => {
      ids.forEach((id) => state.selected.add(id));
      renderMain();
    },
    onClearSelection: () => {
      state.selected.clear();
      renderMain();
    },
    onAnalyzeSelected: analyzeSelected,
    onOpen: openDetail,
    onAdd: () => openForm(null),
    onCollect: startCollect,
    onPaste: openPaste,
    onSample: insertSamples,
  };

  function renderBanner() {
    const root = $('banner-root');
    if (state.fatal) {
      root.replaceChildren(
        el('div', { class: 'banner banner-error', role: 'alert' }, [
          el('div', { class: 'banner-text' }, [el('p', { class: 'banner-title' }, '앱을 시작하지 못했습니다'), el('p', null, state.fatal)]),
        ])
      );
      return;
    }
    if (state.error) {
      const e = state.error;
      const dismiss = () => {
        state.error = null;
        renderBanner();
      };
      const actions = e.actions.map((a) =>
        el(
          'button',
          {
            type: 'button',
            onclick: () => {
              dismiss();
              a.onClick();
            },
          },
          a.label
        )
      );
      root.replaceChildren(
        el('div', { class: 'banner banner-error', role: 'alert' }, [
          el('div', { class: 'banner-text' }, [el('p', { class: 'banner-title' }, e.title), el('p', { class: 'banner-message' }, e.message)]),
          el('div', { class: 'banner-actions' }, actions.concat(el('button', { type: 'button', class: 'btn-quiet', onclick: dismiss }, '닫기'))),
        ])
      );
      return;
    }
    if (!state.backupReminderDismissed && STM.backup.needsBackupReminder(state.rulings.length)) {
      const last = STM.settings.get('lastBackupAt');
      root.replaceChildren(
        el('div', { class: 'banner banner-warn', role: 'status' }, [
          el('span', { class: 'banner-text' }, [
            last ? `마지막 백업(${formatDateTime(last)}) 후 7일이 지났습니다. ` : '아직 백업한 적이 없습니다. ',
            '브라우저 데이터가 지워지면 기록을 되살릴 수 없으니 백업해 두세요.',
          ]),
          el('button', { type: 'button', class: 'btn-primary', onclick: backupHandlers.onExportJson }, '지금 백업'),
          el(
            'button',
            {
              type: 'button',
              onclick: () => {
                state.backupReminderDismissed = true;
                renderBanner();
              },
            },
            '닫기'
          ),
        ])
      );
      return;
    }
    root.replaceChildren();
  }

  function renderMain() {
    const main = $('main');
    if (state.view === 'settings') {
      UI.settings.render(main, Object.assign({}, state, { csvCount: UI.list.visibleRulings(state).length }), settingsHandlers);
    } else {
      UI.list.render(main, state, listHandlers);
    }
    const s = STM.settings.get();
    const days = Number(s.periodDays) || 7;
    $('btn-collect').textContent = days === 7 ? '최근 1주일 수집' : `최근 ${days}일 수집`;
    $('last-fetched').textContent = '마지막 수집: ' + formatDateTime(s.lastFetchedAt);
    renderBanner();
  }

  // 모달이 열려 있으면 Tab 이동이 모달 안에서만 돈다.
  function trapFocus(e) {
    const dialog = document.querySelector('#modal-root .modal');
    if (!dialog) return;
    const items = Array.from(
      dialog.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')
    ).filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!dialog.contains(active) || (e.shiftKey && (active === first || active === dialog))) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function init() {
    $('btn-add').addEventListener('click', () => openForm(null));
    $('btn-collect').addEventListener('click', startCollect);
    $('btn-paste').addEventListener('click', openPaste);
    $('btn-export').addEventListener('click', openBackup);
    $('btn-settings').addEventListener('click', () => setView(state.view === 'settings' ? 'list' : 'settings'));
    $('btn-theme').addEventListener('click', () => {
      applyTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
      if (state.view === 'settings') renderMain(); // 설정 화면의 라디오 선택을 맞춘다
    });
    darkQuery.addEventListener('change', () => applyTheme());
    applyTheme();
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.open) closeModal();
      if (e.key === 'Tab' && modal.open) trapFocus(e);
      // '/' 키로 검색창 포커스
      const tag = e.target && e.target.tagName;
      if (e.key === '/' && !modal.open && state.view === 'list' && !/INPUT|TEXTAREA|SELECT/.test(tag)) {
        const input = $('search-input');
        if (input) {
          e.preventDefault();
          input.focus();
        }
      }
    });
    // 페이지를 떠날 때 입력 중인 메모를 저장하고, AI 분석 중이면 경고한다.
    window.addEventListener('pagehide', closeModal);
    // 탭 전환·최소화 때 미리 저장해 둔다. 상세 패널의 onClose는 메모 flush다.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && modal.open && modal.onClose) modal.onClose();
    });
    window.addEventListener('beforeunload', (e) => {
      if (state.batch.running || state.analyzing.size) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    try {
      await db.open();
    } catch (err) {
      state.fatal = '저장소를 열 수 없습니다: ' + errorMessage(err, err) + ' (사생활 보호 모드에서는 저장이 제한될 수 있습니다)';
      renderBanner();
      return;
    }
    state.persisted = await db.requestPersist();
    try {
      await db.purgeExpiredTrash(C.TRASH_RETENTION_DAYS);
      await reload();
      await recoverMemoDraft();
    } catch (err) {
      state.fatal = '데이터를 불러오지 못했습니다: ' + errorMessage(err, err);
    }
    renderMain();
  }

  init();
})(window.STM);
