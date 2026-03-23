import React from 'react';
import { GuqinNote } from '../types';
import { buildChordJianzipuText, buildJianzipuText } from '../utils/jianzipuFont';

interface Props {
  note: GuqinNote;
  chordNotes?: GuqinNote[];
  noteIdx?: number;
  widthRem?: number;
}

const SINGLE_ENTRY_WIDTH_REM = 4.02;
const REST_ENTRY_WIDTH_REM = 3.9;
const DOUBLE_CHORD_WIDTH_REM = 5.1;
const TRIPLE_CHORD_WIDTH_REM = 5.45;
const QUAD_CHORD_WIDTH_REM = 5.88;

const NUMBER_ROW_HEIGHT_REM = 2.35;
const GLYPH_ROW_HEIGHT_REM = 3.8;
const STACKED_CHORD_ROW_HEIGHT_REM = 4.1;

const accidentalMap: Record<string, string> = { '#': '♯', b: '♭' };

export const getEntryWidthRem = (note: GuqinNote, chordNotes?: GuqinNote[], overrideRem?: number) => {
  if (overrideRem != null) return overrideRem;
  if (note.originalNote.isBarline) return 0.95;
  if (note.originalNote.isDash) return 2.1;

  if (chordNotes && chordNotes.length > 1) {
    if (chordNotes.length >= 4) return QUAD_CHORD_WIDTH_REM;
    if (chordNotes.length === 3) return TRIPLE_CHORD_WIDTH_REM;
    return DOUBLE_CHORD_WIDTH_REM;
  }

  if (note.originalNote.isRest) return REST_ENTRY_WIDTH_REM;

  const { jianpu } = note.originalNote;
  let width = SINGLE_ENTRY_WIDTH_REM;
  if (jianpu.accidental) width += 0.18;
  if (Math.abs(jianpu.octave) > 0) width += 0.08;
  if ((jianpu.dotCount ?? 0) > 0) width += Math.min(0.18, (jianpu.dotCount ?? 0) * 0.06);
  return width;
};

export const getEntryWidth = (note: GuqinNote, chordNotes?: GuqinNote[], overrideRem?: number) =>
  `${getEntryWidthRem(note, chordNotes, overrideRem)}rem`;

const OctaveDots: React.FC<{ count: number; position: 'top' | 'bottom'; compact?: boolean }> = ({
  count,
  position,
  compact = false,
}) => {
  if (!count) return null;

  const sizeClass = compact ? 'h-[2px] w-[2px]' : 'h-[3px] w-[3px]';
  const gapClass = compact ? 'gap-[1px]' : 'gap-[2px]';
  const marginClass = position === 'top' ? (compact ? 'mb-[1px]' : 'mb-[2px]') : 'mt-[1px]';

  return (
    <div className={`flex justify-center leading-[0] ${gapClass} ${marginClass}`}>
      {Array.from({ length: Math.abs(count) }).map((_, i) => (
        <div key={i} className={`${sizeClass} rounded-full bg-stone-900`} />
      ))}
    </div>
  );
};

const DurationDots: React.FC<{ count: number; compact?: boolean }> = ({ count, compact = false }) => {
  if (count <= 0) return null;

  const sizeClass = compact ? 'h-[2px] w-[2px]' : 'h-[3px] w-[3px]';
  const spacingClass = compact ? 'gap-[2px]' : 'gap-[3px]';
  const rightClass = compact ? '-right-[6px] top-[4px]' : '-right-[8px] top-[5px]';

  return (
    <span className={`absolute ${rightClass} inline-flex ${spacingClass}`}>
      {Array.from({ length: count }).map((_, index) => (
        <span key={index} className={`${sizeClass} rounded-full bg-stone-900`} />
      ))}
    </span>
  );
};

const getChordGridColumns = (size: number) => (size >= 3 ? 2 : size);

const getChordGridItemStyle = (size: number, index: number): React.CSSProperties | undefined => {
  if (size === 3 && index === 2) {
    return { gridColumn: '1 / span 2' };
  }
  return undefined;
};

const CompactJianpuToken: React.FC<{ note: GuqinNote }> = ({ note }) => {
  const { jianpu } = note.originalNote;
  const displayAccidental = accidentalMap[jianpu.accidental] || jianpu.accidental;

  return (
    <div className="relative flex min-w-0 flex-col items-center justify-start leading-none">
      <OctaveDots count={jianpu.octave > 0 ? jianpu.octave : 0} position="top" compact />
      <div className="relative flex min-w-[0.9rem] items-center justify-center leading-none">
        {displayAccidental && (
          <span className="absolute -left-[0.45rem] top-[1px] text-[8px] font-bold text-stone-700">
            {displayAccidental}
          </span>
        )}
        <span className="font-serif text-[0.95rem] font-extrabold leading-none text-stone-900">{jianpu.number}</span>
        <DurationDots count={jianpu.dotCount ?? (jianpu.dot ? 1 : 0)} compact />
      </div>
      <OctaveDots count={jianpu.octave < 0 ? jianpu.octave : 0} position="bottom" compact />
    </div>
  );
};

export const JianpuNumberDisplay: React.FC<{
  note: GuqinNote;
  chordNotes?: GuqinNote[];
  noteIdx?: number;
}> = ({ note, chordNotes, noteIdx }) => {
  const { jianpu } = note.originalNote;

  if (note.originalNote.isRest) {
    return (
      <div className="flex w-full flex-col items-center justify-end">
        <div data-note-number-content-idx={noteIdx} className="relative inline-flex items-center justify-center">
          <span className="font-serif text-[1.1rem] font-bold leading-none text-stone-900">0</span>
          <DurationDots count={jianpu.dotCount ?? (jianpu.dot ? 1 : 0)} />
        </div>
      </div>
    );
  }

  if (chordNotes && chordNotes.length > 1) {
    const sorted = [...chordNotes].sort((a, b) => a.string - b.string);
    const columns = getChordGridColumns(sorted.length);

    return (
      <div className="flex w-full justify-center">
        <div
          data-note-number-content-idx={noteIdx}
          className="inline-grid items-start justify-items-center gap-x-[0.22rem] gap-y-[0.16rem]"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {sorted.map((cn, i) => (
            <div key={i} style={getChordGridItemStyle(sorted.length, i)}>
              <CompactJianpuToken note={cn} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const displayAccidental = accidentalMap[jianpu.accidental] || jianpu.accidental;

  return (
    <div className="flex flex-col items-center">
      <OctaveDots count={jianpu.octave > 0 ? jianpu.octave : 0} position="top" />
      <div
        data-note-number-content-idx={noteIdx}
        className="relative inline-flex items-center justify-center leading-none"
      >
        {displayAccidental && (
          <span className="absolute -left-3 top-[2px] text-[9px] font-bold text-stone-700">
            {displayAccidental}
          </span>
        )}
        <span className="font-serif text-[1.18rem] font-extrabold leading-none text-stone-900">
          {jianpu.number}
        </span>
        <DurationDots count={jianpu.dotCount ?? (jianpu.dot ? 1 : 0)} />
      </div>
      <OctaveDots count={jianpu.octave < 0 ? jianpu.octave : 0} position="bottom" />
    </div>
  );
};

export const JianzipuFontDisplay: React.FC<{
  note: GuqinNote;
  chordNotes?: GuqinNote[];
  noteIdx?: number;
}> = ({ note, chordNotes, noteIdx }) => {
  if (note.originalNote.isRest) {
    return <div style={{ minHeight: `${GLYPH_ROW_HEIGHT_REM}rem` }} />;
  }

  if (chordNotes && chordNotes.length > 1) {
    const sorted = [...chordNotes].sort((a, b) => a.string - b.string);
    const chordFontText = sorted.length === 2 ? buildChordJianzipuText(sorted) : null;
    const fallbackTexts = chordFontText ? [] : sorted.map((cn) => buildJianzipuText(cn)).filter(Boolean);
    const columns = getChordGridColumns(sorted.length);
    const minHeightRem = sorted.length >= 3 ? STACKED_CHORD_ROW_HEIGHT_REM : GLYPH_ROW_HEIGHT_REM;
    const fallbackFontSize =
      sorted.length >= 4 ? '1.42rem' : sorted.length === 3 ? '1.34rem' : '1.56rem';

    return (
      <div
        className="flex w-full flex-col items-center justify-start overflow-visible"
        style={{ minHeight: `${minHeightRem}rem` }}
      >
        {chordFontText ? (
          <span
            data-note-glyph-content-idx={noteIdx}
            className="jianzipu-font block text-center text-[2.18rem] leading-[0.95] text-stone-900"
          >
            {chordFontText}
          </span>
        ) : fallbackTexts.length > 0 ? (
          <div
            data-note-glyph-content-idx={noteIdx}
            className="inline-grid content-start items-start justify-items-center gap-x-[0.18rem] gap-y-[0.08rem]"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {fallbackTexts.map((text, i) => (
              <span
                key={i}
                className="jianzipu-font block text-center text-stone-900"
                style={{
                  fontSize: fallbackFontSize,
                  lineHeight: 0.94,
                  ...getChordGridItemStyle(sorted.length, i),
                }}
              >
                {text}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[10px] text-stone-400">?</span>
        )}
      </div>
    );
  }

  const fontText = buildJianzipuText(note);

  return (
    <div className="flex w-full items-start justify-center overflow-visible" style={{ minHeight: `${GLYPH_ROW_HEIGHT_REM}rem` }}>
      {fontText ? (
        <span
          data-note-glyph-content-idx={noteIdx}
          className="jianzipu-font block text-center text-[2.3rem] leading-[0.95] text-stone-900"
        >
          {fontText}
        </span>
      ) : (
        <span className="text-[10px] text-stone-400">?</span>
      )}
    </div>
  );
};

const IndividualUnderlines: React.FC<{ count: number }> = ({ count }) => {
  if (count <= 0) return null;

  return (
    <div className="mt-[4px] flex w-[1.18rem] flex-col items-center gap-[3px]">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-[1.5px] w-full bg-stone-900" />
      ))}
    </div>
  );
};

export const JianzipuChar: React.FC<Props> = ({ note, chordNotes, noteIdx, widthRem }) => {
  const idxAttr = noteIdx != null ? { 'data-note-idx': noteIdx } : {};
  const entryWidthRem = getEntryWidthRem(note, chordNotes, widthRem);

  if (note.originalNote.isBarline) {
    return <div {...idxAttr} className="mx-[4px] mt-1 h-[6.15rem] w-[1px] self-start bg-stone-800" />;
  }

  if (note.originalNote.isDash) {
    return (
      <div className="relative top-[-1px] mx-[2px] inline-flex w-[1.9rem] flex-col items-center justify-start">
        <div {...idxAttr} className="flex h-[1.7rem] w-full flex-col items-center justify-center">
          <span className="scale-x-150 text-[1rem] font-bold text-stone-900">—</span>
        </div>
        <div style={{ minHeight: `${GLYPH_ROW_HEIGHT_REM}rem` }} />
      </div>
    );
  }

  if (note.originalNote.isRest) {
    const { jianpu } = note.originalNote;
    return (
      <div className="relative inline-flex flex-col items-center justify-start" style={{ width: `${entryWidthRem}rem` }}>
        <div
          {...idxAttr}
          className="flex w-full flex-col items-center justify-end pb-[1px]"
          style={{ minHeight: `${NUMBER_ROW_HEIGHT_REM}rem` }}
        >
          <JianpuNumberDisplay note={note} noteIdx={noteIdx} />
          <IndividualUnderlines count={jianpu.underlineCount} />
        </div>
        <JianzipuFontDisplay note={note} noteIdx={noteIdx} />
      </div>
    );
  }

  const { jianpu } = note.originalNote;

  return (
    <div className="relative inline-flex flex-col items-center justify-start align-top" style={{ width: `${entryWidthRem}rem` }}>
      <div
        {...idxAttr}
        className="relative mb-[5px] flex w-full flex-col items-center justify-end px-[0.08rem]"
        style={{ minHeight: `${NUMBER_ROW_HEIGHT_REM}rem` }}
      >
        <JianpuNumberDisplay note={note} chordNotes={chordNotes} noteIdx={noteIdx} />
        <IndividualUnderlines count={jianpu.underlineCount} />
      </div>
      <JianzipuFontDisplay note={note} chordNotes={chordNotes} noteIdx={noteIdx} />
    </div>
  );
};
