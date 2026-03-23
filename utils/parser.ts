import { ParsedNote, JianpuInfo, BeamLevels, BeamSegmentType, TimeModification } from '../types';
import { Note, Key } from 'tonal';

/**
 * Map MusicXML 'fifths' value to a tonal-compatible key name.
 * fifths: number of sharps (+) or flats (-) in key signature.
 */
const FIFTHS_TO_KEY_NAME: Record<number, string> = {
  [-6]: 'Gb', [-5]: 'Db', [-4]: 'Ab', [-3]: 'Eb', [-2]: 'Bb', [-1]: 'F',
  0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#',
};

const VALID_BEAM_TYPES: ReadonlySet<BeamSegmentType> = new Set([
  'begin',
  'continue',
  'end',
  'forward hook',
  'backward hook',
]);

const normalizeBeamType = (rawType: string | null): BeamSegmentType | null => {
  const normalized = (rawType || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (VALID_BEAM_TYPES.has(normalized as BeamSegmentType)) {
    return normalized as BeamSegmentType;
  }
  return null;
};

const parseBeamLevels = (noteEl: Element): BeamLevels | undefined => {
  const beamLevels: BeamLevels = {};

  Array.from(noteEl.querySelectorAll('beam')).forEach((beamEl) => {
    const numberAttr = beamEl.getAttribute('number');
    const level = numberAttr ? parseInt(numberAttr, 10) : NaN;
    if (!Number.isInteger(level) || level < 1) return;

    const beamType = normalizeBeamType(beamEl.textContent);
    if (!beamType) return;

    beamLevels[level] = beamType;
  });

  return Object.keys(beamLevels).length > 0 ? beamLevels : undefined;
};

// New helper to create structural items
const createStructureItem = (type: 'bar' | 'dash', startTime: number): ParsedNote => ({
  step: '', octave: 0, alter: 0, duration: 0, type: '',
  isRest: false,
  isBarline: type === 'bar',
  isDash: type === 'dash',
  voice: 0, staff: 0, chord: false, pitchName: '', absolutePitch: 0, startTime,
  jianpu: { number: '', octave: 0, accidental: '', underlineCount: 0, dot: false, dotCount: 0 }
});

const UNDERLINE_BY_TYPE: Record<string, number> = {
  eighth: 1,
  '16th': 2,
  '32nd': 3,
  '64th': 4,
};

const parseTimeModification = (noteEl: Element): TimeModification | undefined => {
  const timeEl = noteEl.querySelector('time-modification');
  if (!timeEl) return undefined;

  const actualNotes = parseInt(timeEl.querySelector('actual-notes')?.textContent || '0', 10);
  const normalNotes = parseInt(timeEl.querySelector('normal-notes')?.textContent || '0', 10);
  const normalType = timeEl.querySelector('normal-type')?.textContent || undefined;

  if (actualNotes > 0 && normalNotes > 0) {
    return { actualNotes, normalNotes, normalType };
  }

  return undefined;
};

const deriveUnderlineCount = (noteType: string, beats: number): number => {
  if (UNDERLINE_BY_TYPE[noteType] != null) {
    return UNDERLINE_BY_TYPE[noteType];
  }

  if (beats <= 0) return 0;
  if (beats <= 0.125) return 4;
  if (beats <= 0.25) return 3;
  if (beats <= 0.5) return 2;
  if (beats <= 1) return 1;
  return 0;
};

const getNotatedBeats = (beats: number, timeModification?: TimeModification) => {
  if (!timeModification || timeModification.actualNotes <= 0 || timeModification.normalNotes <= 0) {
    return beats;
  }

  return beats * (timeModification.actualNotes / timeModification.normalNotes);
};

/**
 * Calculate Jianpu (numbered musical notation) info from a MIDI pitch number.
 * Uses `tonal` library for music theory: key resolution, scale degrees, chromaticism.
 */
const calculateJianpu = (midi: number, fifths: number, isRest: boolean): JianpuInfo => {
  if (isRest) {
    return { number: '0', octave: 0, accidental: '', underlineCount: 0, dot: false, dotCount: 0 };
  }

  // 1. Resolve key from fifths using tonal
  const keyName = FIFTHS_TO_KEY_NAME[fifths] ?? 'C';
  const key = Key.majorKey(keyName);
  const tonicChroma = Note.chroma(key.tonic) ?? 0; // 0-11 pitch class of tonic
  const scaleNotes = key.scale; // e.g. ['F','G','A','Bb','C','D','E']

  // 2. Determine "Middle 1" — the tonic instance closest to C4 (MIDI 60)
  let baseTonic = tonicChroma;
  while (baseTonic < 60) baseTonic += 12;
  if (Math.abs((baseTonic - 12) - 60) < Math.abs(baseTonic - 60)) {
    baseTonic -= 12;
  }

  // 3. Octave relative to baseTonic
  const diff = midi - baseTonic;
  const octave = Math.floor(diff / 12);

  // 4. Find scale degree using tonal's chroma matching
  const notePC = midi % 12; // pitch class of the input note
  const degreeIndex = scaleNotes.findIndex(n => Note.chroma(n) === notePC);

  let number: string;
  let accidental = '';

  if (degreeIndex >= 0) {
    // Diatonic note — directly map to scale degree (1-indexed)
    number = String(degreeIndex + 1);
  } else {
    // Chromatic note — use MusicXML alter to decide # vs b correctly.
    // Strategy: try both directions, prefer the one that uses the note's
    // original spelling (sharp vs flat from the XML).
    // Attempt sharp: check if (notePC - 1) is a scale degree
    const belowIdx = scaleNotes.findIndex(n => Note.chroma(n) === ((notePC - 1 + 12) % 12));
    // Attempt flat: check if (notePC + 1) is a scale degree
    const aboveIdx = scaleNotes.findIndex(n => Note.chroma(n) === ((notePC + 1) % 12));

    if (belowIdx >= 0 && aboveIdx >= 0) {
      // Both interpretations possible — prefer sharp for common chromatics (#1, #2, #4, #5)
      // and flat for b3, b6, b7 which are more idiomatic in Chinese music theory
      const sharpDegree = belowIdx + 1; // e.g. #1, #2, etc.
      if (sharpDegree <= 2 || sharpDegree === 4 || sharpDegree === 5) {
        number = String(sharpDegree);
        accidental = '#';
      } else {
        number = String(aboveIdx + 1);
        accidental = 'b';
      }
    } else if (belowIdx >= 0) {
      number = String(belowIdx + 1);
      accidental = '#';
    } else if (aboveIdx >= 0) {
      number = String(aboveIdx + 1);
      accidental = 'b';
    } else {
      number = '?';
    }
  }

  return { number, octave, accidental, underlineCount: 0, dot: false, dotCount: 0 };
};

export const parseMusicXML = (xmlContent: string): ParsedNote[] => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlContent, "text/xml");
  const notes: ParsedNote[] = [];
  
  // Only parse the first <part> to avoid mixing multiple instruments
  const firstPart = xmlDoc.querySelector("part");
  if (!firstPart) return notes;
  const measures = Array.from(firstPart.querySelectorAll("measure"));
  let measureStartTime = 0;
  let currentFifths = 0; // Default to C
  let currentDivisions = 1; // Persist across measures (MusicXML spec: divisions only appears when changed)
  let nextBeamGroupId = 1;
  let activeBeamGroupId = 0;

  measures.forEach((measure) => {
    // Get divisions for this measure (update only if present)
    const attrNode = measure.querySelector('attributes');
    
    if (attrNode) {
        const divNode = attrNode.querySelector('divisions');
        if (divNode && divNode.textContent) currentDivisions = parseInt(divNode.textContent, 10);
        
        const keyNode = attrNode.querySelector('key > fifths');
        if (keyNode && keyNode.textContent) currentFifths = parseInt(keyNode.textContent, 10);
    }

    const divisions = currentDivisions;

    const children = Array.from(measure.children);
    let currentOffset = 0;
    let maxOffset = 0; // Track the furthest point reached in this measure
    let previousNoteStartTime = measureStartTime;

    children.forEach((child) => {
      if (child.tagName === 'note') {
        const rest = child.querySelector('rest');
        const chord = child.querySelector('chord') !== null;
        const durationNode = child.querySelector('duration');
        const duration = durationNode ? parseInt(durationNode.textContent || '0', 10) : 0;
        
        const pitch = child.querySelector('pitch');
        const voice = parseInt(child.querySelector('voice')?.textContent || '1', 10);
        
        // Dot check
        const dotCount = child.querySelectorAll('dot').length;
        const isDotted = dotCount > 0;
        
        const typeNode = child.querySelector('type');
        const noteType = typeNode ? typeNode.textContent : '';
        const timeModification = parseTimeModification(child);
        
        // Tie detection: <tie type="stop"/> means this note continues a previous tie
        const ties = Array.from(child.querySelectorAll('tie'));
        const isTieStop = ties.some(t => t.getAttribute('type') === 'stop');

        const beamLevels = parseBeamLevels(child);
        const beam1Type = beamLevels?.[1] ?? '';

        const slurElements = Array.from(child.querySelectorAll('slur'));
        const hasSlurStart = slurElements.some(s => s.getAttribute('type') === 'start');
        const hasSlurStop = slurElements.some(s => s.getAttribute('type') === 'stop');

        const tiedElements = Array.from(child.querySelectorAll('tied'));
        const hasTiedStart = tiedElements.some(t => t.getAttribute('type') === 'start');
        const hasTiedStop = tiedElements.some(t => t.getAttribute('type') === 'stop');
        
        // Only parse voice 1 (right hand / melody).
        // Left hand (voice 5 in piano scores) is skipped — guqin arrangement
        // focuses on the melodic line.
        if (voice > 1) {
           if (!chord) currentOffset += duration;
           maxOffset = Math.max(maxOffset, currentOffset);
           return;
        }

        // Rhythm Calculation:
        // - beats: actual sounded duration in quarter-note units
        // - notatedBeats: notation-facing duration after reversing tuplet compression
        const quarterDuration = divisions;
        const beats = duration / quarterDuration;
        const notatedBeats = getNotatedBeats(beats, timeModification);
        const underlineCount = deriveUnderlineCount(noteType || '', notatedBeats);

        let noteStartTime = measureStartTime + currentOffset;
        if (chord) {
          noteStartTime = previousNoteStartTime;
        } else {
          previousNoteStartTime = noteStartTime;
        }

        let noteData: ParsedNote = {
          step: '', octave: 0, alter: 0, duration,
          type: noteType || '',
          isRest: !!rest,
          isBarline: false,
          isDash: false,
          voice, staff: 1, chord,
          pitchName: '',
          absolutePitch: 0,
          startTime: noteStartTime,
          timeModification,
          beamLevels,
          jianpu: { number: '0', octave: 0, accidental: '', underlineCount, dot: isDotted, dotCount }
        };

        if (pitch) {
          const step = pitch.querySelector('step')?.textContent || 'C';
          const octave = parseInt(pitch.querySelector('octave')?.textContent || '4', 10);
          const alter = parseInt(pitch.querySelector('alter')?.textContent || '0', 10);
          noteData.step = step; noteData.octave = octave; noteData.alter = alter;
          // Build pitch name for tonal: e.g. "C4", "F#5", "Bb3"
          const accStr = alter > 0 ? '#'.repeat(alter) : alter < 0 ? 'b'.repeat(-alter) : '';
          const tonalPitchName = `${step}${accStr}${octave}`;
          noteData.absolutePitch = Note.midi(tonalPitchName) ?? 0;
          
          noteData.jianpu = { 
              ...calculateJianpu(noteData.absolutePitch, currentFifths, false),
              underlineCount,
              dot: isDotted,
              dotCount
          };
        } else if (rest) {
           noteData.jianpu = {
               ...calculateJianpu(0, currentFifths, true),
               underlineCount,
               dot: isDotted,
               dotCount
           };
        }

        // Store beat count for downstream dash generation
        noteData.beats = beats;

        // Mark tie continuations — don't re-attack these on guqin.
        // Dash generation is deferred to generateDashes() after chord reduction
        // so that multi-voice duplicate dashes are avoided.
        if (isTieStop) {
            noteData.isTied = true;
        }

        if (beam1Type === 'begin') {
            activeBeamGroupId = nextBeamGroupId++;
            noteData.beamGroupId = activeBeamGroupId;
        } else if ((beam1Type === 'continue' || beam1Type === 'end') && activeBeamGroupId > 0) {
            noteData.beamGroupId = activeBeamGroupId;
            if (beam1Type === 'end') activeBeamGroupId = 0;
        } else if (beam1Type === 'forward hook' || beam1Type === 'backward hook') {
            noteData.beamGroupId = nextBeamGroupId++;
        }

        if (hasSlurStart) noteData.slurStart = true;
        if (hasSlurStop) noteData.slurStop = true;
        if (hasTiedStart) noteData.tieStart = true;
        if (hasTiedStop) noteData.tieStop = true;

        notes.push(noteData);

        if (!chord) {
           currentOffset += duration;
           maxOffset = Math.max(maxOffset, currentOffset);
        }

      } else if (child.tagName === 'backup') {
        const duration = parseInt(child.querySelector('duration')?.textContent || '0', 10);
        currentOffset -= duration;
      } else if (child.tagName === 'forward') {
        const duration = parseInt(child.querySelector('duration')?.textContent || '0', 10);
        currentOffset += duration;
        maxOffset = Math.max(maxOffset, currentOffset);
      }
    });

    // Use maxOffset for measure duration to handle multi-voice backup correctly
    notes.push(createStructureItem('bar', measureStartTime + maxOffset));
    measureStartTime += maxOffset; 
  });

  return notes;
};

export const recalculateJianpu = (notes: ParsedNote[], fifths: number): ParsedNote[] => {
    return notes.map(note => {
        if (note.isBarline || note.isDash) return note;
        const j = calculateJianpu(note.absolutePitch, fifths, note.isRest);
        return {
            ...note,
            jianpu: {
                ...j,
                underlineCount: note.jianpu.underlineCount,
                dot: note.jianpu.dot,
                dotCount: note.jianpu.dotCount ?? 0
            }
        };
    });
};

/**
 * Generate dashes for long notes and tie continuations.
 * 
 * Must be called AFTER chord reduction so that multi-voice parsing
 * doesn't produce duplicate dashes at the same startTime.
 * 
 * Handles chord groups (primary + chord members) as a unit:
 * - Uses the longest note's beats for dash count
 * - All-tied chords become dashes; mixed tied/non-tied keeps only non-tied
 * 
 * Rules:
 * - Tied notes (isTied): replaced entirely with floor(beats) dashes
 * - Long notes (beats >= 2): append floor(beats) - 1 dashes after the note
 */
export const generateDashes = (notes: ParsedNote[]): ParsedNote[] => {
    const result: ParsedNote[] = [];
    let i = 0;
    while (i < notes.length) {
        const note = notes[i];

        if (note.isBarline || note.isDash) {
            result.push(note);
            i++;
            continue;
        }

        // Collect chord group: primary note + consecutive chord members
        const chordGroup: ParsedNote[] = [note];
        while (
            i + 1 < notes.length &&
            notes[i + 1].chord &&
            !notes[i + 1].isBarline &&
            !notes[i + 1].isDash
        ) {
            i++;
            chordGroup.push(notes[i]);
        }

        const allTied = chordGroup.every(n => n.isTied);

        if (allTied) {
            // All notes are tie continuations: replace with dashes
            const maxBeats = Math.max(...chordGroup.map(n => n.beats ?? 0));
            const totalDashes = Math.max(1, Math.floor(maxBeats));
            for (let d = 0; d < totalDashes; d++) {
                result.push({ ...createStructureItem('dash', note.startTime), dashFromTie: true });
            }
        } else {
            // Push non-tied notes in the chord group
            for (const cn of chordGroup) {
                if (!cn.isTied) result.push(cn);
            }
            // Dashes based on max beats of non-tied notes (whole chord sustains together)
            const maxBeats = Math.max(
                ...chordGroup.filter(n => !n.isTied).map(n => n.beats ?? 0)
            );
            if (maxBeats >= 2) {
                const dashCount = Math.floor(maxBeats) - 1;
                for (let d = 0; d < dashCount; d++) {
                    result.push(createStructureItem('dash', note.startTime));
                }
            }
        }

        i++;
    }
    return result;
};
