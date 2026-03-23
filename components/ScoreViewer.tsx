import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toPng } from 'html-to-image';
import { TUNINGS } from '../constants';
import { GuqinNote } from '../types';
import { BeamEntry, BeamGroup } from './BeamGroup';
import { getEntryWidthRem, JianzipuChar } from './JianzipuChar';
import { calculateArcs, DisplayEntry, SlurArc } from '../utils/arcGeometry';

interface Props {
  notes: GuqinNote[];
  tuningName?: string;
  title?: string;
  hideToolbar?: boolean;
  autoPreview?: boolean;
}

interface RenderUnit {
  key: string;
  node: React.ReactNode;
  widthRem: number;
  kind: 'beam' | 'note' | 'dash' | 'barline';
}

interface PositionedLine {
  units: RenderUnit[];
  templateColumns: string;
}

const FIFTHS_TO_KEY: Record<number, string> = {
  [-6]: 'Gb',
  [-5]: 'Db',
  [-4]: 'Ab',
  [-3]: 'Eb',
  [-2]: 'Bb',
  [-1]: 'F',
  0: 'C',
  1: 'G',
  2: 'D',
  3: 'A',
  4: 'E',
  5: 'B',
  6: 'F#',
};

const DEFAULT_SCORE_WIDTH_REM = 52;
const MIN_UNIT_GAP_REM = 0.28;
const BARLINE_WIDTH_REM = 0.95;
const DASH_WIDTH_REM = 2.1;
const WIDTH_ROUNDING_STEPS = 20;

const estimateEntryWidthRem = (entry: DisplayEntry, overrideRem?: number) => {
  if (entry.note.originalNote.isBarline) return BARLINE_WIDTH_REM;
  if (entry.note.originalNote.isDash) return DASH_WIDTH_REM;
  return getEntryWidthRem(entry.note, entry.chordNotes, overrideRem);
};

const roundWidthRem = (widthRem: number) => Math.ceil(widthRem * WIDTH_ROUNDING_STEPS) / WIDTH_ROUNDING_STEPS;

const widthMapsEqual = (left: Record<number, number>, right: Record<number, number>) => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key) => {
    const leftValue = left[Number(key)];
    const rightValue = right[Number(key)];
    return Math.abs(leftValue - rightValue) < 0.02;
  });
};

const sumUnitWidths = (units: RenderUnit[]) =>
  units.reduce((total, unit, index) => total + unit.widthRem + (index > 0 ? MIN_UNIT_GAP_REM : 0), 0);

const getGapWeight = (left: RenderUnit, right: RenderUnit) => {
  let weight = 1;

  if (left.kind === 'barline' || right.kind === 'barline') {
    weight += 1.4;
  } else if (left.kind === 'dash' || right.kind === 'dash') {
    weight += 0.7;
  } else if (left.kind === 'beam' || right.kind === 'beam') {
    weight += 0.15;
  }

  return weight;
};

const getGapCap = (left: RenderUnit, right: RenderUnit) => {
  if (left.kind === 'barline' || right.kind === 'barline') return 1.85;
  if (left.kind === 'dash' || right.kind === 'dash') return 1.3;
  return 1.05;
};

const distributeLineGaps = (line: RenderUnit[], maxLineWidthRem: number) => {
  const gapCount = line.length - 1;
  if (gapCount <= 0) return [];

  const contentWidth = line.reduce((total, unit) => total + unit.widthRem, 0);
  const minTotalGap = gapCount * MIN_UNIT_GAP_REM;
  const availableGapSpace = Math.max(minTotalGap, maxLineWidthRem - contentWidth);
  const gaps = new Array(gapCount).fill(MIN_UNIT_GAP_REM);
  let remaining = Math.max(0, availableGapSpace - minTotalGap);

  const weights = line.slice(0, -1).map((unit, index) => getGapWeight(unit, line[index + 1]));
  const caps = line.slice(0, -1).map((unit, index) => getGapCap(unit, line[index + 1]));

  while (remaining > 0.0001) {
    const eligible = gaps
      .map((gap, index) => ({
        index,
        weight: weights[index],
        headroom: caps[index] - gap,
      }))
      .filter((slot) => slot.headroom > 0.0001);

    if (eligible.length === 0) {
      gaps[gaps.length - 1] += remaining;
      break;
    }

    const totalWeight = eligible.reduce((sum, slot) => sum + slot.weight, 0);
    let consumed = 0;

    eligible.forEach((slot) => {
      const allocation = remaining * (slot.weight / totalWeight);
      const applied = Math.min(allocation, slot.headroom);
      gaps[slot.index] += applied;
      consumed += applied;
    });

    if (consumed <= 0.0001) {
      gaps[gaps.length - 1] += remaining;
      break;
    }

    remaining -= consumed;
  }

  return gaps;
};

const buildPositionedLine = (line: RenderUnit[], maxLineWidthRem: number): PositionedLine => {
  if (line.length === 0) {
    return { units: line, templateColumns: '' };
  }

  if (line.length === 1) {
    return {
      units: line,
      templateColumns: `${line[0].widthRem}rem minmax(0, 1fr)`,
    };
  }

  const gaps = distributeLineGaps(line, maxLineWidthRem);
  const templateColumns = line
    .flatMap((unit, index) => {
      const columns = [`${unit.widthRem}rem`];
      if (index < gaps.length) columns.push(`${gaps[index]}rem`);
      return columns;
    })
    .join(' ');

  return { units: line, templateColumns };
};

const buildBalancedLines = (units: RenderUnit[], maxLineWidthRem: number): RenderUnit[][] => {
  if (units.length === 0) return [];

  const n = units.length;
  const prefixWidths = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i += 1) {
    prefixWidths[i + 1] = prefixWidths[i] + units[i].widthRem;
  }

  const segmentWidth = (start: number, end: number) => {
    const width = prefixWidths[end + 1] - prefixWidths[start];
    const gaps = end > start ? (end - start) * MIN_UNIT_GAP_REM : 0;
    return width + gaps;
  };

  const bestCost = new Array(n + 1).fill(Number.POSITIVE_INFINITY);
  const nextBreak = new Array(n).fill(-1);
  bestCost[n] = 0;

  for (let start = n - 1; start >= 0; start -= 1) {
    for (let end = start; end < n; end += 1) {
      const width = segmentWidth(start, end);
      if (width > maxLineWidthRem && end > start) break;

      const nextIndex = end + 1;
      if (nextIndex < n && (units[nextIndex].kind === 'barline' || units[nextIndex].kind === 'dash')) {
        continue;
      }

      const isLastLine = nextIndex === n;
      const slack = Math.max(0, maxLineWidthRem - width);
      let cost = isLastLine ? slack * 0.15 : slack * slack;

      if (!isLastLine && width < maxLineWidthRem * 0.76) {
        cost += (maxLineWidthRem * 0.76 - width) * 16;
      }

      if (units[end].kind === 'barline') {
        cost *= 0.88;
      }

      if (!isLastLine && bestCost[nextIndex] !== Number.POSITIVE_INFINITY) {
        const totalCost = cost + bestCost[nextIndex];
        if (totalCost < bestCost[start]) {
          bestCost[start] = totalCost;
          nextBreak[start] = nextIndex;
        }
      } else if (isLastLine && cost < bestCost[start]) {
        bestCost[start] = cost;
        nextBreak[start] = nextIndex;
      }
    }
  }

  const lines: RenderUnit[][] = [];
  let index = 0;
  while (index < n) {
    const nextIndex = nextBreak[index] > index ? nextBreak[index] : Math.min(n, index + 1);
    lines.push(units.slice(index, nextIndex));
    index = nextIndex;
  }

  return lines;
};

export const ScoreViewer: React.FC<Props> = ({ notes, tuningName, title, hideToolbar = false, autoPreview = false }) => {
  const scoreRef = useRef<HTMLDivElement>(null);
  const scoreBodyRef = useRef<HTMLDivElement>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [slurArcs, setSlurArcs] = useState<SlurArc[]>([]);
  const [scoreBodyWidthPx, setScoreBodyWidthPx] = useState(0);
  const [rootRemPx, setRootRemPx] = useState(16);
  const [entryWidthOverrides, setEntryWidthOverrides] = useState<Record<number, number>>({});
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const tuningInfo = TUNINGS.find((t) => t.name === tuningName);
  const keySignature = FIFTHS_TO_KEY[tuningInfo?.fifths ?? -1] || 'F';
  const tuningSolfege = tuningInfo?.solfege || '5 6 1 2 3 5 6';
  const tuningDisplay = `1=${keySignature} (${tuningName?.split(' ')[0]}定弦 ${tuningSolfege})`;

  const entries = useMemo<DisplayEntry[]>(() => {
    const result: DisplayEntry[] = [];
    let i = 0;
    let index = 0;

    while (i < notes.length) {
      const note = notes[i];
      const chordGroup: GuqinNote[] = [note];
      while (
        i + 1 < notes.length &&
        notes[i + 1].originalNote.chord &&
        !notes[i + 1].originalNote.isBarline &&
        !notes[i + 1].originalNote.isDash
      ) {
        i += 1;
        chordGroup.push(notes[i]);
      }

      result.push({
        note: chordGroup[0],
        chordNotes: chordGroup.length > 1 ? chordGroup : undefined,
        index,
      });

      index += 1;
      i += 1;
    }

    return result;
  }, [notes]);

  const getEntryWidthForDisplay = useCallback(
    (entry: DisplayEntry) => estimateEntryWidthRem(entry, entryWidthOverrides[entry.index]),
    [entryWidthOverrides]
  );

  const renderUnits = useMemo<RenderUnit[]>(() => {
    const units: RenderUnit[] = [];
    let i = 0;

    while (i < entries.length) {
      const entry = entries[i];
      const beamGroupId = entry.note.originalNote.beamGroupId;
      const isStructural = entry.note.originalNote.isBarline || entry.note.originalNote.isDash;

      if (beamGroupId && !isStructural) {
        const beamEntries: BeamEntry[] = [
          { note: entry.note, chordNotes: entry.chordNotes, index: entry.index },
        ];

        while (
          i + 1 < entries.length &&
          entries[i + 1].note.originalNote.beamGroupId === beamGroupId &&
          !entries[i + 1].note.originalNote.isBarline &&
          !entries[i + 1].note.originalNote.isDash
        ) {
          i += 1;
          beamEntries.push({
            note: entries[i].note,
            chordNotes: entries[i].chordNotes,
            index: entries[i].index,
          });
        }

        if (beamEntries.length > 1) {
          const widthRem = beamEntries.reduce((sum, beamEntry) => sum + getEntryWidthForDisplay(beamEntry), 0);
          const beamWidthRems = beamEntries.map((beamEntry) => getEntryWidthForDisplay(beamEntry));

          units.push({
            key: `beam-${beamGroupId}-${entry.index}`,
            node: (
              <BeamGroup
                key={`beam-${beamGroupId}-${entry.index}`}
                entries={beamEntries}
                entryWidthRems={beamWidthRems}
              />
            ),
            widthRem,
            kind: 'beam',
          });
        } else {
          const single = beamEntries[0];
          units.push({
            key: `note-${single.index}`,
            node: (
              <div key={`note-${single.index}`}>
                <JianzipuChar
                  note={single.note}
                  chordNotes={single.chordNotes}
                  noteIdx={single.index}
                  widthRem={getEntryWidthForDisplay(single)}
                />
              </div>
            ),
            widthRem: getEntryWidthForDisplay(single),
            kind: single.note.originalNote.isBarline
              ? 'barline'
              : single.note.originalNote.isDash
                ? 'dash'
                : 'note',
          });
        }
      } else {
        units.push({
          key: `note-${entry.index}`,
          node: (
            <div key={`note-${entry.index}`}>
              <JianzipuChar
                note={entry.note}
                chordNotes={entry.chordNotes}
                noteIdx={entry.index}
                widthRem={getEntryWidthForDisplay(entry)}
              />
            </div>
          ),
          widthRem: getEntryWidthForDisplay(entry),
          kind: entry.note.originalNote.isBarline
            ? 'barline'
            : entry.note.originalNote.isDash
              ? 'dash'
              : 'note',
        });
      }

      i += 1;
    }

    return units;
  }, [entries, getEntryWidthForDisplay]);

  const maxLineWidthRem = useMemo(
    () => (scoreBodyWidthPx > 0 ? Math.max(28, scoreBodyWidthPx / rootRemPx - 1.2) : DEFAULT_SCORE_WIDTH_REM),
    [rootRemPx, scoreBodyWidthPx]
  );

  const lineUnits = useMemo(() => buildBalancedLines(renderUnits, maxLineWidthRem), [renderUnits, maxLineWidthRem]);

  const positionedLines = useMemo(
    () => lineUnits.map((line) => buildPositionedLine(line, maxLineWidthRem)),
    [lineUnits, maxLineWidthRem]
  );

  useEffect(() => {
    const container = scoreBodyRef.current;
    if (!container || entries.length === 0) {
      setSlurArcs([]);
      setScoreBodyWidthPx(0);
      setEntryWidthOverrides({});
      return;
    }

    const compute = () => {
      const remPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize || '16') || 16;
      setScoreBodyWidthPx(container.clientWidth);
      setRootRemPx((current) => (Math.abs(current - remPx) > 0.01 ? remPx : current));

      const nextWidthOverrides: Record<number, number> = {};
      entries.forEach((entry) => {
        if (entry.note.originalNote.isBarline || entry.note.originalNote.isDash) return;

        const numberContent = container.querySelector(
          `[data-note-number-content-idx="${entry.index}"]`
        ) as HTMLElement | null;
        const glyphContent = container.querySelector(
          `[data-note-glyph-content-idx="${entry.index}"]`
        ) as HTMLElement | null;

        const baseWidthRem = estimateEntryWidthRem(entry);
        let requiredWidthPx = baseWidthRem * remPx;

        if (numberContent) {
          requiredWidthPx = Math.max(requiredWidthPx, numberContent.getBoundingClientRect().width + 16);
        }

        if (glyphContent) {
          const glyphPaddingPx = entry.chordNotes && entry.chordNotes.length > 2 ? 20 : 14;
          requiredWidthPx = Math.max(requiredWidthPx, glyphContent.getBoundingClientRect().width + glyphPaddingPx);
        }

        const requiredWidthRem = roundWidthRem(requiredWidthPx / remPx);
        if (requiredWidthRem > baseWidthRem + 0.02 || entryWidthOverrides[entry.index] != null) {
          nextWidthOverrides[entry.index] = Math.max(baseWidthRem, requiredWidthRem);
        }
      });

      setEntryWidthOverrides((current) => (widthMapsEqual(current, nextWidthOverrides) ? current : nextWidthOverrides));
      setSlurArcs(calculateArcs(entries, container));
    };

    document.fonts.ready.then(() => {
      requestAnimationFrame(() => requestAnimationFrame(compute));
    });

    const resizeObserver = new ResizeObserver(compute);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [entries, entryWidthOverrides]);

  useEffect(() => {
    if (!autoPreview || !scoreRef.current || notes.length === 0) {
      setPreviewImageUrl(null);
      document.body.dataset.guqinPngReady = '0';
      return;
    }

    let cancelled = false;

    const generatePreview = async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!scoreRef.current || cancelled) return;

      try {
        const dataUrl = await toPng(scoreRef.current, {
          cacheBust: true,
          backgroundColor: '#ffffff',
          pixelRatio: 2,
        });
        if (cancelled) return;
        setPreviewImageUrl(dataUrl);
        (window as Window & { __GUQIN_PNG__?: string }).__GUQIN_PNG__ = dataUrl;
        document.body.dataset.guqinPngReady = '1';
      } catch (err) {
        console.error('Failed to generate preview image', err);
        document.body.dataset.guqinPngReady = 'error';
      }
    };

    document.body.dataset.guqinPngReady = '0';
    generatePreview();

    return () => {
      cancelled = true;
    };
  }, [autoPreview, notes, slurArcs]);

  const handleDownload = useCallback(async () => {
    if (!scoreRef.current) return;

    setIsDownloading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const dataUrl = await toPng(scoreRef.current, {
        cacheBust: true,
        backgroundColor: '#ffffff',
        pixelRatio: 3,
      });

      const link = document.createElement('a');
      link.download = `${title || 'guqin-score'}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to generate image', err);
      alert('Could not generate image. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  }, [title]);

  if (notes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center font-serif text-stone-400">
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full border-4 border-stone-400 opacity-20">
          <span className="text-4xl">琴</span>
        </div>
        <p className="text-lg tracking-widest text-stone-500">AWAITING SCORE</p>
        <p className="mt-2 text-sm opacity-60">Please upload a MusicXML file</p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-full w-full flex-col items-center">
      {!hideToolbar && (
        <div className="sticky top-0 z-50 mb-4 flex gap-3 print:hidden">
          <button
            onClick={handleDownload}
            disabled={isDownloading}
            className="flex items-center gap-2 rounded bg-stone-900 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-stone-50 shadow-xl transition-all hover:-translate-y-0.5 hover:bg-amber-900 disabled:cursor-not-allowed disabled:opacity-70 disabled:transform-none"
          >
            {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isDownloading ? 'Inking...' : 'Export PNG'}
          </button>
        </div>
      )}

      <div
        ref={scoreRef}
        data-testid="score-sheet"
        className="relative mb-16 min-h-[900px] w-full max-w-[1160px] bg-white p-14 shadow-2xl print:p-0 print:shadow-none"
      >
        <div className="mb-8 flex flex-col items-center">
          <h1 className="mb-4 font-serif text-4xl font-bold tracking-[0.08em] text-black">
            {title || '古琴谱'}
          </h1>
          <div className="flex w-full justify-start pl-1">
            <p className="font-serif text-sm font-bold tracking-widest text-black">{tuningDisplay}</p>
          </div>
        </div>

        <div ref={scoreBodyRef} className="relative min-h-[520px]">
          <div className="flex flex-col items-start gap-y-12">
            {positionedLines.map((line, index) => (
              <div
                key={`line-${index}`}
                data-line-index={index}
                className="grid w-full items-end"
                style={{ gridTemplateColumns: line.templateColumns }}
              >
                {line.units.map((unit, unitIndex) => (
                  <div key={unit.key} style={{ gridColumn: unitIndex * 2 + 1 }}>
                    {unit.node}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {slurArcs.length > 0 && (
            <svg className="pointer-events-none absolute left-0 top-0 h-full w-full" style={{ overflow: 'visible' }}>
              {slurArcs.map((arc, index) => (
                <path
                  key={index}
                  d={arc.d}
                  fill="none"
                  stroke="#1c1917"
                  strokeWidth={arc.type === 'slur' ? 1.4 : 1}
                  strokeLinecap="round"
                />
              ))}
            </svg>
          )}
        </div>
      </div>

      {autoPreview && previewImageUrl && (
        <div className="mt-6 flex w-full max-w-[1160px] flex-col items-start gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-400">Preview PNG</div>
          <img
            src={previewImageUrl}
            alt="Rendered guqin score preview"
            className="w-full rounded border border-stone-200 bg-white shadow"
          />
        </div>
      )}
    </div>
  );
};
