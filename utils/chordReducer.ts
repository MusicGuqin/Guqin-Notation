import { ParsedNote } from '../types';
import { Chord, Note } from 'tonal';

/**
 * Guqin Chord Reducer
 * 
 * Problem: Piano scores can have 3-4+ simultaneous notes across two hands.
 * Guqin can play at most 2 simultaneous notes (using 撮 cuo / 拨 bo techniques),
 * or occasionally 3 with arpeggiated techniques (rare).
 *
 * Strategy:
 * 1. Group simultaneous notes by startTime
 * 2. Use tonal's Chord.detect() to identify the harmonic function
 * 3. Reduce to max 2 notes, keeping the most musically important ones:
 *    - Root (bass foundation) + Melody (highest note, usually the tune)
 *    - If only 2 notes, keep both
 *    - If 1 note, keep as-is
 * 4. Apply guqin range filter (MIDI 36-74 for standard tuning, extendable to ~84 with 按 at hui 4)
 *
 * Musical priority rules:
 *   1. Melody note (highest pitch in treble) — always keep
 *   2. Bass root — keep if interval with melody is playable on guqin (≤ 2 octaves apart)
 *   3. If bass root duplicates melody's pitch class, pick the 5th or 3rd instead
 */

/** Maximum simultaneous notes guqin can play */
const MAX_GUQIN_SIMULTANEOUS = 2;

/** Guqin effective range: open string 1 (C2=36) to string 7 hui 4 (D5≈74) */
const GUQIN_RANGE_MIN = 36;
const GUQIN_RANGE_MAX = 74; // D5, reachable on string 7 at hui 4

/**
 * Given a group of simultaneous ParsedNotes, reduce to at most `maxNotes`
 * notes that capture the musical essence for guqin performance.
 * 
 * Tied notes (isTied) are deprioritized — new attacks are always preferred.
 * If only tied notes remain, reduce those (they'll become dashes downstream).
 */
const reduceChordGroup = (group: ParsedNote[], maxNotes: number = MAX_GUQIN_SIMULTANEOUS): ParsedNote[] => {
  // Separate new attacks from tie continuations and rests
  const newAttacks = group.filter(n => !n.isTied && !n.isRest && !n.isBarline && !n.isDash && n.absolutePitch > 0);
  const tied = group.filter(n => n.isTied);
  const rests = group.filter(n => n.isRest);

  // Determine which notes to reduce
  let candidates: ParsedNote[];
  if (newAttacks.length > 0) {
    // New attacks take priority — tied continuations are absorbed
    candidates = newAttacks;
  } else if (tied.length > 0) {
    // Only tie continuations — keep up to maxNotes (they'll become dashes)
    candidates = tied;
  } else if (rests.length > 0) {
    return [rests[0]]; // Single rest
  } else {
    return group; // Shouldn't happen, but be safe
  }

  if (candidates.length <= maxNotes) {
    return candidates.map((n, i) => ({ ...n, chord: i > 0 }));
  }

  // Sort by pitch (low to high)
  const sorted = [...candidates].sort((a, b) => a.absolutePitch - b.absolutePitch);
  
  const melody = sorted[sorted.length - 1]; // Highest = melody
  const bassNote = sorted[0];               // Lowest = bass

  // Use tonal to detect chord and find root
  const pitchNames = sorted.map(n => {
    const acc = n.alter > 0 ? '#'.repeat(n.alter) : n.alter < 0 ? 'b'.repeat(-n.alter) : '';
    return `${n.step}${acc}${n.octave}`;
  });
  
  const detected = Chord.detect(pitchNames);
  
  let selectedNotes: ParsedNote[] = [];

  if (maxNotes === 1) {
    // Solo mode: just the melody
    selectedNotes = [melody];
  } else {
    // Duo mode (撮/拨): melody + bass
    // Check if bass and melody are the same pitch class
    if ((bassNote.absolutePitch % 12) === (melody.absolutePitch % 12) && sorted.length > 2) {
      // Bass duplicates melody's pitch class — pick a more interesting bass
      // Try chord root from tonal detection, then 5th, then 3rd
      let altBass = findAlternativeBass(sorted, melody, detected);
      selectedNotes = [altBass, melody];
    } else {
      selectedNotes = [bassNote, melody];
    }

    // Ensure both notes are within guqin range
    selectedNotes = selectedNotes.map(n => clampToGuqinRange(n));
    
    // If after clamping both notes are identical pitch class and octave, keep just melody
    if (selectedNotes.length === 2 && 
        selectedNotes[0].absolutePitch === selectedNotes[1].absolutePitch) {
      selectedNotes = [melody];
    }
  }

  // Mark the second note onwards as chord members
  return selectedNotes.map((n, i) => ({
    ...n,
    chord: i > 0,
  }));
};

/**
 * When the bass duplicates the melody's pitch class, find a more interesting
 * alternative from the remaining chord tones.
 */
const findAlternativeBass = (
  sorted: ParsedNote[], 
  melody: ParsedNote, 
  detected: string[]
): ParsedNote => {
  const melodyPC = melody.absolutePitch % 12;
  
  // Try to find the chord root from tonal
  if (detected.length > 0) {
    const chordName = detected[0];
    // Extract tonic from chord name (e.g. "GM" -> "G", "DM/A" -> "D")
    const slashIdx = chordName.indexOf('/');
    const baseName = slashIdx >= 0 ? chordName.substring(0, slashIdx) : chordName;
    // Get root note name (the tonic letters before the quality)
    const chordInfo = Chord.get(baseName);
    if (chordInfo.tonic) {
      const rootPC = Note.chroma(chordInfo.tonic);
      if (rootPC !== undefined && rootPC !== melodyPC) {
        // Find a note in our sorted array with this pitch class
        const rootNote = sorted.find(n => (n.absolutePitch % 12) === rootPC);
        if (rootNote) return rootNote;
      }
    }
  }

  // Fallback: pick the lowest non-duplicate note
  for (const n of sorted) {
    if ((n.absolutePitch % 12) !== melodyPC) return n;
  }
  
  // Ultimate fallback: just the lowest note
  return sorted[0];
};

/**
 * If a note is outside guqin's effective range, transpose it by octaves
 * to bring it within range.
 */
const clampToGuqinRange = (note: ParsedNote): ParsedNote => {
  let midi = note.absolutePitch;
  
  if (midi < GUQIN_RANGE_MIN) {
    // Transpose up by octaves
    while (midi < GUQIN_RANGE_MIN) midi += 12;
  } else if (midi > GUQIN_RANGE_MAX) {
    // Transpose down by octaves 
    while (midi > GUQIN_RANGE_MAX) midi -= 12;
  }
  
  if (midi === note.absolutePitch) return note;
  
  // Recalculate octave
  const newOctave = Math.floor(midi / 12) - 1;
  return {
    ...note,
    absolutePitch: midi,
    octave: newOctave,
    // jianpu octave will be recalculated by recalculateJianpu later
  };
};

/**
 * Main entry point: process a full ParsedNote[] array through chord reduction.
 * 
 * Input should NOT contain dashes (call generateDashes() afterwards).
 * Groups simultaneous notes (same startTime, including <chord/> marked and 
 * cross-staff notes), reduces each group, and returns a flat array.
 */
export const reduceChords = (notes: ParsedNote[]): ParsedNote[] => {
  // Group notes by startTime; barlines pass through
  const groups: Map<number, ParsedNote[]> = new Map();
  const barlines: ParsedNote[] = [];
  
  for (const note of notes) {
    if (note.isBarline) {
      barlines.push(note);
      continue;
    }
    // Dashes shouldn't be here (generated after reduction), but pass through if present
    if (note.isDash) continue;
    
    const key = note.startTime;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(note);
  }
  
  // Reduce each group
  const processedGroups: ParsedNote[] = [];
  for (const [_time, group] of groups) {
    const reduced = reduceChordGroup(group);
    processedGroups.push(...reduced);
  }
  
  // Merge with barlines, sorted by startTime
  const allItems = [
    ...processedGroups.map(n => ({ note: n, time: n.startTime, isBarline: false })),
    ...barlines.map(n => ({ note: n, time: n.startTime, isBarline: true })),
  ];
  
  allItems.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    // Barlines first at same time — a barline marks the END of the previous
    // measure, so it must appear BEFORE any notes that start the next measure
    // at the same time point.
    if (a.isBarline !== b.isBarline) return a.isBarline ? -1 : 1;
    // Among pitched notes: non-chord first, then chord members
    if (!a.isBarline && !b.isBarline) {
      return (a.note.chord ? 1 : 0) - (b.note.chord ? 1 : 0);
    }
    return 0;
  });
  
  return allItems.map(item => item.note);
};
