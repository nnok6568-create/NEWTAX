/* 동작 확인용 샘플 데이터 (실제 예규/판례가 아님) */
(function (STM) {
  'use strict';

  const { todayStr, addDays } = STM.utils;

  function build() {
    const today = todayStr();
    return [
      {
        docNo: '샘플-대법원-2026두0001',
        type: '판례',
        title: '[샘플] 전기로 설비 개체 시 기존 설비 처분손실의 손금 산입 시기',
        summary: '노후 전기로를 철거하고 신규 설비로 교체하는 경우, 기존 설비의 장부가액을 철거가 완료된 사업연도의 손금으로 산입할 수 있는지가 쟁점이 된 사례(동작 확인용 가상 데이터).',
        issuer: '대법원(샘플)',
        date: addDays(today, -1),
        category: '법인세',
        relevance: '상',
        analysis: {
          implications: [
            '설비 개체가 잦은 철강사는 철거 완료 시점과 손금 산입 시점의 차이를 점검해야 한다.',
            '고로·전기로 개보수 계획이 있는 경우 처분손실 인식 시기에 따라 법인세 부담이 달라질 수 있다.',
          ],
          reviewItems: [
            { text: '최근 3개 사업연도 설비 폐기·철거 내역과 손금 산입 연도 대조', checked: false },
            { text: '철거 완료를 입증할 증빙(작업완료 보고서, 사진 등) 보관 여부 확인', checked: false },
            { text: '경정청구 대상 여부 검토', checked: false },
          ],
          relatedRefs: ['샘플-조심-2026-지방-0003', '샘플-서면-2025-법인-9999'],
          model: 'sample',
          analyzedAt: new Date().toISOString(),
        },
      },
      {
        docNo: '샘플-서면-2026-부가-0002',
        type: '예규',
        title: '[샘플] 철스크랩 매입자납부특례 적용 시 공급가액 정정 방법',
        summary: '철스크랩 거래에서 매입자납부특례가 적용되는 경우, 사후 단가 정산으로 공급가액이 변경되면 수정세금계산서 발급과 부가세 입금 방법을 어떻게 처리하는지에 대한 질의회신(동작 확인용 가상 데이터).',
        issuer: '국세청(샘플)',
        date: addDays(today, -3),
        category: '부가세',
        relevance: '상',
        analysis: {
          implications: ['스크랩 단가 사후 정산 구조를 가진 전기로 업체는 수정세금계산서 및 전용계좌 입금 처리 절차를 재점검할 필요가 있다.'],
          reviewItems: [
            { text: '단가 정산 계약 조항과 수정세금계산서 발급 사유 일치 여부 확인', checked: false },
            { text: '부가세 전용계좌 추가 입금·환급 처리 내역 점검', checked: false },
          ],
          relatedRefs: [],
          model: 'sample',
          analyzedAt: new Date().toISOString(),
        },
      },
      {
        docNo: '샘플-조심-2026-지방-0003',
        type: '심판례',
        title: '[샘플] 제철소 부지 내 공장용 건축물의 재산세 분리과세 범위',
        summary: '제철소 부지 중 공장용 건축물 바닥면적의 일정 배율 이내 토지를 분리과세 대상으로 볼 수 있는지가 쟁점이 된 결정(동작 확인용 가상 데이터).',
        issuer: '조세심판원(샘플)',
        date: addDays(today, -5),
        category: '지방세',
        subCategories: ['법인세'],
        relevance: '중',
      },
    ];
  }

  STM.samples = { build };
})(window.STM);
