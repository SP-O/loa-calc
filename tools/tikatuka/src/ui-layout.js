// 화면 칸(cell, 좌→우 0,1,2) ↔ 주사위 packed 인덱스(0 = 먼저 놓인 것) 매핑.
// 내 필드(me): 중앙(오른쪽)부터 채움 → 먼저 놓인 주사위가 가장 오른쪽(cell 2).
// 상대 필드(opp): 중앙(왼쪽)부터 채움 → 먼저 놓인 주사위가 가장 왼쪽(cell 0).

export function dieIndexToCell(side, dieIndex) {
  return side === 'me' ? 2 - dieIndex : dieIndex;
}

export function cellToDieIndex(side, lineLength, cell) {
  if (side === 'me') {
    if (cell < 3 - lineLength) return -1; // 빈 칸
    return 2 - cell;
  }
  if (cell >= lineLength) return -1; // 빈 칸
  return cell;
}

export function nextFillCell(side, lineLength) {
  if (lineLength >= 3) return -1; // 가득 참
  return side === 'me' ? 2 - lineLength : lineLength;
}
