import React, { useMemo } from 'react';
import { getEntryWidth, JianpuNumberDisplay, JianzipuFontDisplay } from './JianzipuChar';
import { BeamLevels, BeamSegmentType } from '../types';
import { DisplayEntry } from '../utils/arcGeometry';

export type BeamEntry = DisplayEntry;

interface Props {
  entries: BeamEntry[];
  entryWidthRems?: number[];
}

interface BeamSegment {
  level: number;
  startIndex: number;
  endIndex: number;
  hook?: Exclude<BeamSegmentType, 'begin' | 'continue' | 'end'>;
}

const DEFAULT_ENTRY_WIDTH_REM = 3.45;
const SEGMENT_CAP_REM = 0.42;
const HOOK_LENGTH_REM = 0.92;
const GROUP_SIDE_PADDING_REM = 0.16;
const BEAM_THICKNESS_PX = 2;
const BEAM_GAP_PX = 5;

const parseWidthRem = (width: string): number => {
  const parsed = Number.parseFloat(width.replace('rem', ''));
  return Number.isFinite(parsed) ? parsed : DEFAULT_ENTRY_WIDTH_REM;
};

const getBeamLevels = (entry: BeamEntry): BeamLevels => entry.note.originalNote.beamLevels ?? {};

const buildFallbackSegments = (entries: BeamEntry[], maxLevel: number): BeamSegment[] => {
  const segments: BeamSegment[] = [];

  for (let level = 1; level <= maxLevel; level += 1) {
    let startIndex: number | null = null;

    entries.forEach((entry, index) => {
      const active = entry.note.originalNote.jianpu.underlineCount >= level;
      const nextActive =
        index + 1 < entries.length && entries[index + 1].note.originalNote.jianpu.underlineCount >= level;

      if (active && startIndex === null) {
        startIndex = index;
      }

      if (!active && startIndex !== null) {
        if (index - 1 > startIndex) {
          segments.push({ level, startIndex, endIndex: index - 1 });
        } else {
          segments.push({ level, startIndex, endIndex: startIndex, hook: 'backward hook' });
        }
        startIndex = null;
      }

      if (active && !nextActive && startIndex !== null) {
        if (index > startIndex) {
          segments.push({ level, startIndex, endIndex: index });
        } else {
          segments.push({ level, startIndex, endIndex: index, hook: 'backward hook' });
        }
        startIndex = null;
      }
    });
  }

  return segments;
};

const buildExplicitSegments = (entries: BeamEntry[], maxLevel: number): BeamSegment[] => {
  const segments: BeamSegment[] = [];

  for (let level = 1; level <= maxLevel; level += 1) {
    let startIndex: number | null = null;

    entries.forEach((entry, index) => {
      const state = getBeamLevels(entry)[level];
      if (!state) return;

      if (state === 'begin') {
        startIndex = index;
        return;
      }

      if (state === 'continue') {
        if (startIndex === null) {
          startIndex = Math.max(0, index - 1);
        }
        return;
      }

      if (state === 'end') {
        const resolvedStart = startIndex ?? Math.max(0, index - 1);
        if (index > resolvedStart) {
          segments.push({ level, startIndex: resolvedStart, endIndex: index });
        }
        startIndex = null;
        return;
      }

      segments.push({
        level,
        startIndex: index,
        endIndex: index,
        hook: state,
      });
    });
  }

  return segments;
};

export const BeamGroup: React.FC<Props> = ({ entries, entryWidthRems }) => {
  if (entries.length === 0) return null;

  const columnWidths = useMemo(
    () => entries.map((entry, index) => getEntryWidth(entry.note, entry.chordNotes, entryWidthRems?.[index])),
    [entries, entryWidthRems]
  );
  const columnWidthsRem = useMemo(() => columnWidths.map(parseWidthRem), [columnWidths]);
  const totalWidthRem = useMemo(
    () => columnWidthsRem.reduce((sum, width) => sum + width, GROUP_SIDE_PADDING_REM * 2),
    [columnWidthsRem]
  );
  const centersRem = useMemo(() => {
    let offset = GROUP_SIDE_PADDING_REM;
    return columnWidthsRem.map((width) => {
      const center = offset + width / 2;
      offset += width;
      return center;
    });
  }, [columnWidthsRem]);

  const explicitMaxLevel = useMemo(
    () =>
      Math.max(
        0,
        ...entries.flatMap((entry) =>
          Object.keys(getBeamLevels(entry))
            .map((level) => Number(level))
            .filter((level) => Number.isFinite(level))
        )
      ),
    [entries]
  );
  const fallbackMaxLevel = Math.max(...entries.map((entry) => entry.note.originalNote.jianpu.underlineCount), 0);
  const maxLevel = Math.max(explicitMaxLevel, fallbackMaxLevel);

  const beamSegments = useMemo(() => {
    if (explicitMaxLevel > 0) {
      return buildExplicitSegments(entries, explicitMaxLevel);
    }
    return buildFallbackSegments(entries, fallbackMaxLevel);
  }, [entries, explicitMaxLevel, fallbackMaxLevel]);

  const beamAreaHeight = maxLevel > 0 ? maxLevel * BEAM_THICKNESS_PX + (maxLevel - 1) * BEAM_GAP_PX : 0;

  return (
    <div className="inline-flex flex-col align-top overflow-visible" style={{ width: `${totalWidthRem}rem` }}>
      <div
        className="grid items-end"
        style={{
          gridTemplateColumns: columnWidths.join(' '),
          columnGap: 0,
          paddingLeft: `${GROUP_SIDE_PADDING_REM}rem`,
          paddingRight: `${GROUP_SIDE_PADDING_REM}rem`,
        }}
      >
        {entries.map((entry, index) => (
          <div
            key={`num-${entry.index}`}
            data-note-idx={entry.index}
            className="flex min-h-[2.15rem] flex-col items-center justify-end px-[0.08rem]"
            style={{ gridColumn: index + 1 }}
          >
            <JianpuNumberDisplay note={entry.note} chordNotes={entry.chordNotes} noteIdx={entry.index} />
          </div>
        ))}
      </div>

      {beamAreaHeight > 0 && (
        <div className="relative mt-[5px]" style={{ height: `${beamAreaHeight}px` }}>
          {beamSegments.map((segment, index) => {
            const top = (segment.level - 1) * (BEAM_THICKNESS_PX + BEAM_GAP_PX);

            if (segment.hook) {
              const center = centersRem[segment.startIndex];
              const left =
                segment.hook === 'forward hook'
                  ? center
                  : Math.max(GROUP_SIDE_PADDING_REM * 0.25, center - HOOK_LENGTH_REM);
              const width =
                segment.hook === 'forward hook'
                  ? Math.min(HOOK_LENGTH_REM, totalWidthRem - GROUP_SIDE_PADDING_REM * 0.25 - left)
                  : Math.min(HOOK_LENGTH_REM, center - GROUP_SIDE_PADDING_REM * 0.25);

              return (
                <div
                  key={`hook-${segment.level}-${segment.startIndex}-${index}`}
                  className="absolute rounded-full bg-stone-900"
                  style={{
                    left: `${left}rem`,
                    top: `${top}px`,
                    width: `${Math.max(width, 0.38)}rem`,
                    height: `${BEAM_THICKNESS_PX}px`,
                  }}
                />
              );
            }

            const startCenter = centersRem[segment.startIndex];
            const endCenter = centersRem[segment.endIndex];
            const left = Math.max(GROUP_SIDE_PADDING_REM * 0.25, startCenter - SEGMENT_CAP_REM);
            const right = Math.min(totalWidthRem - GROUP_SIDE_PADDING_REM * 0.25, endCenter + SEGMENT_CAP_REM);

            return (
              <div
                key={`seg-${segment.level}-${segment.startIndex}-${segment.endIndex}-${index}`}
                className="absolute rounded-full bg-stone-900"
                style={{
                  left: `${left}rem`,
                  top: `${top}px`,
                  width: `${Math.max(right - left, 0.55)}rem`,
                  height: `${BEAM_THICKNESS_PX}px`,
                }}
              />
            );
          })}
        </div>
      )}

      <div
        className="mt-[8px] grid items-start"
        style={{
          gridTemplateColumns: columnWidths.join(' '),
          columnGap: 0,
          paddingLeft: `${GROUP_SIDE_PADDING_REM}rem`,
          paddingRight: `${GROUP_SIDE_PADDING_REM}rem`,
        }}
      >
        {entries.map((entry, index) => (
          <div
            key={`font-${entry.index}`}
            className="flex justify-center px-[0.08rem]"
            style={{ gridColumn: index + 1 }}
          >
            <JianzipuFontDisplay note={entry.note} chordNotes={entry.chordNotes} noteIdx={entry.index} />
          </div>
        ))}
      </div>
    </div>
  );
};
