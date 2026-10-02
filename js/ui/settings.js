/* 설정 화면: AI, 수집, 백업, 저장소, 데이터, 휴지통 (PRD 5.2, F2-3, F6) */
(function (STM) {
  'use strict';

  const { el, formatDateTime, maskKey } = STM.utils;
  const C = STM.constants;

  function daysLeft(deletedAt) {
    const expires = Date.parse(deletedAt) + C.TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    return Math.max(0, Math.ceil((expires - Date.now()) / (24 * 60 * 60 * 1000)));
  }

  function settingsSection(title, children) {
    return el('section', { class: 'settings-section' }, [el('h3', null, title)].concat(children));
  }

  function inputField(id, label, input, help) {
    input.id = id;
    return el('div', { class: 'field' }, [el('label', { for: id }, label), input, help ? el('p', { class: 'help' }, help) : null]);
  }

  function renderAi(s, h) {
    const keyInput = el('input', {
      type: 'password',
      autocomplete: 'off',
      placeholder: s.apiKey ? `저장됨 (${maskKey(s.apiKey)}) — 바꾸려면 새 키 입력` : 'sk-ant-…',
    });
    const modelInput = el('input', { type: 'text', value: s.model, placeholder: STM.settings.DEFAULTS.model });
    const testBtn = el('button', { type: 'button', disabled: !s.apiKey }, '연결 테스트');
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.textContent = '테스트 중…';
      await h.onTestAi();
      testBtn.disabled = false;
      testBtn.textContent = '연결 테스트';
    });
    return settingsSection('AI 분석 (Claude API)', [
      el('p', { class: 'notice' }, 'API 키는 이 브라우저에만 저장되며, 분석 요청 시 Anthropic으로만 전송됩니다. 공용 PC에서는 사용하지 마세요.'),
      el('p', { class: 'notice confidential' }, C.CONFIDENTIAL_NOTICE),
      inputField('set-api-key', 'Claude API 키', keyInput),
      inputField('set-model', '모델', modelInput, `기본값: ${STM.settings.DEFAULTS.model}`),
      el('div', { class: 'detail-actions' }, [
        el(
          'button',
          {
            type: 'button',
            class: 'btn-primary',
            onclick: () => {
              h.onSaveAi({ apiKey: keyInput.value.trim(), model: modelInput.value.trim() });
              keyInput.value = '';
            },
          },
          '저장'
        ),
        testBtn,
        el('button', { type: 'button', class: 'btn-danger', disabled: !s.apiKey, onclick: h.onDeleteKey }, '키 삭제'),
      ]),
    ]);
  }

  function renderCollect(s, h) {
    const ocInput = el('input', { type: 'text', autocomplete: 'off', value: s.lawApiKey, placeholder: '법제처 Open API 신청 시 등록한 OC 값' });
    const daysInput = el('input', { type: 'number', min: '1', max: '90', value: String(s.periodDays) });
    const proxyInput = el('input', { type: 'url', value: s.proxyUrl, placeholder: '예: https://프록시주소/?url={url}' });
    return settingsSection('수집 (법제처 국가법령정보 Open API)', [
      inputField('set-oc', '법제처 인증키 (OC)', ocInput),
      inputField('set-days', '수집 기간 (일)', daysInput, '기본 7일 (1~90)'),
      inputField(
        'set-proxy',
        '프록시 URL (선택)',
        proxyInput,
        '브라우저 보안 정책(CORS) 때문에 법제처 API에 직접 접속되지 않을 때 사용합니다. {url} 자리에 원래 주소가 들어가며, 없으면 끝에 붙습니다. 사내에서 승인된 프록시만 사용하세요.'
      ),
      el('div', { class: 'detail-actions' }, [
        el(
          'button',
          {
            type: 'button',
            class: 'btn-primary',
            onclick: () => h.onSaveCollect({ lawApiKey: ocInput.value.trim(), periodDays: Number(daysInput.value), proxyUrl: proxyInput.value.trim() }),
          },
          '저장'
        ),
      ]),
    ]);
  }

  // 헤더의 [내보내기] 창과 설정 화면에서 함께 쓴다.
  function renderBackupPanel(info, h) {
    const fileInput = el('input', { type: 'file', accept: '.json,application/json', id: 'backup-file', 'aria-label': '백업 파일' });
    const mergeRadio = el('input', { type: 'radio', name: 'import-mode', value: 'merge', checked: true });
    const overwriteRadio = el('input', { type: 'radio', name: 'import-mode', value: 'overwrite' });
    const importBtn = el('button', { type: 'button', disabled: true }, '가져오기');
    fileInput.addEventListener('change', () => {
      importBtn.disabled = !fileInput.files.length;
    });
    importBtn.addEventListener('click', async () => {
      if (!fileInput.files.length) return;
      importBtn.disabled = true;
      await h.onImportJson(fileInput.files[0], overwriteRadio.checked ? 'overwrite' : 'merge');
      importBtn.disabled = false;
    });

    return el('div', { class: 'backup-panel' }, [
      el('p', { class: 'detail-dates' }, `마지막 백업: ${formatDateTime(info.lastBackupAt)}`),
      el('div', { class: 'detail-actions align-start' }, [
        el('button', { type: 'button', class: 'btn-primary', onclick: h.onExportJson }, 'JSON 백업 내보내기'),
        el('button', { type: 'button', disabled: !info.csvCount, onclick: h.onExportCsv }, `CSV 내보내기 (현재 목록 ${info.csvCount}건)`),
      ]),
      el('p', { class: 'help' }, 'JSON 백업에는 예규/판례·분석 결과·메모가 모두 들어가며 API 키 등 설정은 포함되지 않습니다. CSV는 현재 목록 화면의 세목·필터가 적용된 건만 내보냅니다.'),
      el('div', { class: 'import-box' }, [
        el('h4', null, '백업 가져오기'),
        fileInput,
        el('div', { class: 'check-row' }, [
          el('label', null, [mergeRadio, ' 병합 (같은 문서번호는 더 최근에 수정된 쪽 유지)']),
          el('label', null, [overwriteRadio, ' 덮어쓰기 (현재 데이터를 모두 지우고 교체)']),
        ]),
        importBtn,
      ]),
    ]);
  }

  function renderTrash(trash, h) {
    if (!trash.length) return el('p', { class: 'placeholder' }, '휴지통이 비어 있습니다.');
    const sorted = trash.slice().sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    return el(
      'ul',
      { class: 'trash-list' },
      sorted.map((r) =>
        el('li', null, [
          el('div', { class: 'trash-info' }, [
            el('span', { class: 'doc-no' }, r.docNo),
            ' ',
            el('span', null, r.title),
            el('p', { class: 'detail-dates' }, `삭제 ${formatDateTime(r.deletedAt)} · ${daysLeft(r.deletedAt)}일 후 영구 삭제`),
          ]),
          el('div', { class: 'trash-actions' }, [
            el('button', { type: 'button', onclick: () => h.onRestore(r.id) }, '복원'),
            el('button', { type: 'button', class: 'btn-danger', onclick: () => h.onHardDelete(r) }, '영구 삭제'),
          ]),
        ])
      )
    );
  }

  function renderTheme(current, h) {
    const options = [
      ['system', '시스템 설정 따르기'],
      ['light', '라이트'],
      ['dark', '다크'],
    ];
    return el('fieldset', { class: 'theme-fieldset' }, [
      el('legend', null, '화면 모드'),
      el(
        'div',
        { class: 'theme-options' },
        options.map(([value, label]) =>
          el('label', null, [
            el('input', { type: 'radio', name: 'theme', value, checked: (current || 'system') === value, onchange: () => h.onThemeChange(value) }),
            label,
          ])
        )
      ),
      el('p', { class: 'help' }, '헤더의 ☾/☀ 버튼으로도 바꿀 수 있습니다.'),
    ]);
  }

  function render(root, state, h) {
    const s = STM.settings.get();
    root.replaceChildren(
      el('div', { class: 'settings' }, [
        el('div', { class: 'settings-head' }, [el('button', { type: 'button', onclick: h.onBack }, '← 목록으로'), el('h2', null, '설정')]),
        renderAi(s, h),
        renderCollect(s, h),
        settingsSection('백업', [
          el('p', { class: 'section-desc' }, [
            `저장된 예규/판례 ${state.rulings.length}건, 휴지통 ${state.trash.length}건. `,
            state.persisted
              ? '영구 저장이 허용되어 브라우저가 데이터를 자동으로 지우지 않습니다.'
              : '브라우저가 영구 저장을 허용하지 않았습니다. 브라우저 데이터를 삭제하면 기록이 사라질 수 있으니 주기적으로 백업하세요.',
          ]),
          renderBackupPanel({ lastBackupAt: s.lastBackupAt, csvCount: state.csvCount }, h),
          el('div', { class: 'import-box' }, [
            el('h4', null, '샘플 데이터'),
            el('p', { class: 'help' }, '화면을 둘러볼 수 있게 세목이 다른 예시 3건을 넣습니다. 같은 문서번호가 있으면 건너뜁니다.'),
            el('button', { type: 'button', onclick: h.onSample }, '샘플 데이터 넣기'),
          ]),
        ]),
        settingsSection(`휴지통 (${C.TRASH_RETENTION_DAYS}일 보관)`, [renderTrash(state.trash, h)]),
        settingsSection('화면', [renderTheme(s.theme, h)]),
      ])
    );
  }

  STM.ui.settings = { render, renderBackupPanel };
})(window.STM);
