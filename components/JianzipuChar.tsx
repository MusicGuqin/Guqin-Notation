import React from 'react';
import { GuqinNote, HandTechnique, LeftHand, RightHand } from '../types';
import { buildJianzipuText, buildChordJianzipuText } from '../utils/jianzipuFont';

interface Props {
  note: GuqinNote;
  chordNotes?: GuqinNote[]; // For chord groups (simultaneous notes)
}

const OctaveDots: React.FC<{ count: number; position: 'top' | 'bottom' }> = ({ count, position }) => {
    if (!count) return null;
    return (
        <div className={`flex justify-center gap-[2px] leading-[0] ${position === 'top' ? 'mb-[1px]' : 'mt-[0px]'}`}>
            {Array.from({ length: Math.abs(count) }).map((_, i) => (
                <div key={i} className="w-[4px] h-[4px] bg-stone-900 rounded-full" />
            ))}
        </div>
    );
};

/** Render the Jianpu (numbered notation) row for a note */
const JianpuSection: React.FC<{ note: GuqinNote }> = ({ note }) => {
  const { jianpu } = note.originalNote;
  const accidentalMap: Record<string, string> = { '#': '♯', 'b': '♭' };
  const displayAccidental = accidentalMap[jianpu.accidental] || jianpu.accidental;

  return (
    <div className="flex flex-col items-center justify-end h-[2.5rem] w-full relative mb-1">
      <OctaveDots count={jianpu.octave > 0 ? jianpu.octave : 0} position="top" />
      <div className="relative flex items-center justify-center leading-none">
        {displayAccidental && (
          <span className="absolute -left-3 top-[2px] text-[10px] font-bold text-stone-700">
            {displayAccidental}
          </span>
        )}
        <span className="text-[1.5rem] font-extrabold font-serif text-stone-900">
          {jianpu.number}
        </span>
        {jianpu.dot && (
          <span className="absolute -right-3 top-[6px] w-[4px] h-[4px] bg-stone-900 rounded-full"></span>
        )}
      </div>
      <OctaveDots count={jianpu.octave < 0 ? jianpu.octave : 0} position="bottom" />
      {jianpu.underlineCount > 0 && (
        <div className="flex flex-col gap-[3px] mt-[4px] w-[1.2rem] items-center">
          <div className="w-full h-[2px] bg-stone-900" />
          {jianpu.underlineCount > 1 && <div className="w-full h-[2px] bg-stone-900" />}
        </div>
      )}
    </div>
  );
};

export const JianzipuChar: React.FC<Props> = ({ note, chordNotes }) => {
  // 1. Barline
  if (note.originalNote.isBarline) {
    return <div className="w-[1px] h-[7rem] bg-stone-800 mx-2 self-start mt-1" />;
  }

  // 2. Dash (duration extension)
  if (note.originalNote.isDash) {
    return (
      <div className="inline-flex flex-col items-center justify-start w-[2.5rem] mx-1 relative top-[-4px]">
        <div className="flex flex-col items-center justify-center h-[2.5rem] w-full">
          <span className="text-xl font-bold text-stone-900 scale-x-150">—</span>
        </div>
        <div className="h-[4rem]" />
      </div>
    );
  }

  // 3. Rest
  if (note.originalNote.isRest) {
    const { jianpu } = note.originalNote;
    return (
      <div className="inline-flex flex-col items-center justify-start w-[3.5rem] relative">
        <div className="flex flex-col items-center justify-end h-[2.5rem] w-full pb-1">
          <div className="relative">
            <span className="text-[1.4rem] font-bold font-serif leading-none text-stone-900">0</span>
            {jianpu.dot && <div className="absolute top-1 -right-2 w-[3.5px] h-[3.5px] bg-stone-900 rounded-full" />}
          </div>
          {jianpu.underlineCount > 0 && (
            <div className="flex flex-col gap-[3px] mt-[3px] w-[14px] items-center">
              <div className="w-full h-[2px] bg-stone-900" />
              {jianpu.underlineCount > 1 && <div className="w-full h-[2px] bg-stone-900" />}
            </div>
          )}
        </div>
        <div className="h-[4rem]" />
      </div>
    );
  }

  // 4. Chord group (multiple simultaneous notes)
  if (chordNotes && chordNotes.length > 1) {
    const { jianpu } = note.originalNote;
    const sorted = [...chordNotes].sort((a, b) => a.string - b.string);

    // Use the font's 撮 (cuo) chord encoding for 2-note chords
    const chordFontText = buildChordJianzipuText(sorted);
    // Fallback: render each note separately if chord text fails
    const fallbackTexts = chordFontText ? null : sorted.map(cn => buildJianzipuText(cn)).filter(Boolean);

    return (
      <div className="inline-flex flex-col items-center justify-start align-top relative px-2">
        {/* Jianpu numbers */}
        <div className="flex flex-col items-center justify-end h-[2.5rem] w-full relative mb-1">
          <div className="flex gap-1 items-center justify-center">
            {sorted.map((cn, ci) => (
              <span key={ci} className="text-[1.2rem] font-extrabold font-serif text-stone-900">
                {cn.originalNote.jianpu.number}
              </span>
            ))}
          </div>
          {jianpu.underlineCount > 0 && (
            <div className="flex flex-col gap-[3px] mt-[4px] w-[1.2rem] items-center">
              <div className="w-full h-[2px] bg-stone-900" />
              {jianpu.underlineCount > 1 && <div className="w-full h-[2px] bg-stone-900" />}
            </div>
          )}
        </div>
        {/* Jianzipu: single 撮 character or fallback stacked */}
        <div className="w-[4.5rem] h-[4rem] flex flex-col items-center justify-start gap-0">
          {chordFontText ? (
            <span className="jianzipu-font text-[3.5rem] leading-none text-stone-900">
              {chordFontText}
            </span>
          ) : fallbackTexts ? (
            fallbackTexts.map((text, ci) => (
              <span key={ci} className="jianzipu-font text-[2.5rem] leading-[1.1] text-stone-900">
                {text}
              </span>
            ))
          ) : (
            <span className="text-sm text-stone-400">?</span>
          )}
        </div>
      </div>
    );
  }

  // 5. Regular note — render via font
  const fontText = buildJianzipuText(note);

  return (
    <div className="inline-flex flex-col items-center justify-start align-top relative px-2">
      {/* Jianpu (numbered notation) section */}
      <JianpuSection note={note} />

      {/* Jianzipu section — single span rendered by the font */}
      <div className="w-[3.5rem] h-[4rem] flex items-start justify-center">
        {fontText ? (
          <span className="jianzipu-font text-[3.5rem] leading-none text-stone-900">
            {fontText}
          </span>
        ) : (
          <span className="text-sm text-stone-400">?</span>
        )}
      </div>
    </div>
  );
};