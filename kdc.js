'use strict';

// 한국십진분류법(KDC) 주류. 배열 순서 = 분류번호 첫째 자리 (0 → 000 총류, 8 → 800 문학)
const KDC = ['총류', '철학', '종교', '사회과학', '자연과학', '기술과학', '예술', '언어', '문학', '역사'];

// 문학(800)의 형식. 1~8은 KDC 문학 번호의 셋째 자리와 같은 순서이고, 9는 작법(KDC 802 문학 작법).
// 번호가 저장되므로 기존 항목의 순서는 바꾸지 말고 새 항목은 뒤에 추가할 것.
const LIT_FORMS = [null, '시', '희곡', '소설', '수필', '연설·웅변', '일기·서간·기행', '풍자·유머', '르포르타주·기타', '작법'];
const LITERATURE = '8';

// 이전 버전의 자유 입력 "종류"를 KDC로 옮길 때 쓰는 표
const LEGACY_GENRE_MAP = {
  '소설': { main: '8', form: '3' },
  '시': { main: '8', form: '1' },
  '희곡': { main: '8', form: '2' },
  '에세이': { main: '8', form: '4' },
  '수필': { main: '8', form: '4' },
  '작법': { main: '8', form: '9' },
  '철학': { main: '1' },
  '종교': { main: '2' },
  '경제/경영': { main: '3' },
  '과학': { main: '4' },
  '예술': { main: '6' },
  '만화': { main: '6' },
  '역사': { main: '9' },
};

function kdcCode({ kdcMain }) {
  return kdcMain ? `${kdcMain}00` : '';
}

// 화면 표시용 이름 (예: "문학 · 소설", "역사")
function kdcName({ kdcMain, litForm }) {
  if (!kdcMain) return '';
  const form = kdcMain === LITERATURE && litForm ? LIT_FORMS[litForm] : '';
  return form ? `${KDC[kdcMain]} · ${form}` : KDC[kdcMain];
}
