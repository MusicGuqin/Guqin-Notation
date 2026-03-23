import { GuqinNote } from '../types';

export interface DisplayEntry {
  note: GuqinNote;
  chordNotes?: GuqinNote[];
  index: number;
}

export interface SlurArc {
  d: string;
  type: 'slur' | 'tie';
}

const SAME_ROW_THRESHOLD = 28;
const SLUR_MAX_HEIGHT = 18;
const SLUR_HEIGHT_RATIO = 0.1;
const SLUR_HEIGHT_BASE = 7;
const TIE_MAX_HEIGHT = 10;
const TIE_HEIGHT_RATIO = 0.06;
const TIE_HEIGHT_BASE = 4;
const EDGE_INSET = 14;
const ANCHOR_OFFSET = 2;

export function calculateArcs(entries: DisplayEntry[], container: HTMLElement): SlurArc[] {
  const arcs: SlurArc[] = [];
  const slurStack: number[] = [];

  for (const entry of entries) {
    if (entry.note.originalNote.slurStop && slurStack.length > 0) {
      const startIdx = slurStack.pop()!;
      const arc = buildArc(startIdx, entry.index, container, 'slur');
      if (arc) arcs.push(arc);
    }
    if (entry.note.originalNote.slurStart) {
      slurStack.push(entry.index);
    }
  }

  return arcs;
}

function buildArc(
  startIdx: number,
  endIdx: number,
  container: HTMLElement,
  type: 'slur' | 'tie'
): SlurArc | null {
  const startEl = container.querySelector(`[data-note-idx="${startIdx}"]`) as HTMLElement | null;
  const endEl = container.querySelector(`[data-note-idx="${endIdx}"]`) as HTMLElement | null;
  if (!startEl || !endEl) return null;

  const containerRect = container.getBoundingClientRect();
  const startRect = startEl.getBoundingClientRect();
  const endRect = endEl.getBoundingClientRect();
  const isSlur = type === 'slur';

  const x1 = startRect.left - containerRect.left + startRect.width / 2;
  const x2 = endRect.left - containerRect.left + endRect.width / 2;
  const y1 = isSlur
    ? startRect.top - containerRect.top - ANCHOR_OFFSET
    : startRect.top - containerRect.top + startRect.height + ANCHOR_OFFSET;
  const y2 = isSlur
    ? endRect.top - containerRect.top - ANCHOR_OFFSET
    : endRect.top - containerRect.top + endRect.height + ANCHOR_OFFSET;

  const span = Math.abs(x2 - x1);
  const arcHeight = isSlur
    ? Math.min(SLUR_MAX_HEIGHT, span * SLUR_HEIGHT_RATIO + SLUR_HEIGHT_BASE)
    : Math.min(TIE_MAX_HEIGHT, span * TIE_HEIGHT_RATIO + TIE_HEIGHT_BASE);

  const rawY1 = startRect.top - containerRect.top;
  const rawY2 = endRect.top - containerRect.top;
  const sameRow = Math.abs(rawY1 - rawY2) < SAME_ROW_THRESHOLD;

  if (sameRow) {
    const midX = (x1 + x2) / 2;
    const cpY = isSlur ? Math.min(y1, y2) - arcHeight : Math.max(y1, y2) + arcHeight;
    return { d: `M ${x1} ${y1} Q ${midX} ${cpY} ${x2} ${y2}`, type };
  }

  const rightEdge = containerRect.width - EDGE_INSET;
  const leftEdge = EDGE_INSET;
  const direction = isSlur ? -1 : 1;
  const cpY1 = y1 + direction * arcHeight;
  const cpY2 = y2 + direction * arcHeight;
  const first = `M ${x1} ${y1} Q ${(x1 + rightEdge) / 2} ${cpY1} ${rightEdge} ${y1}`;
  const second = `M ${leftEdge} ${y2} Q ${(leftEdge + x2) / 2} ${cpY2} ${x2} ${y2}`;
  return { d: `${first} ${second}`, type };
}
