import { GuqinNote, GuqinTuning, HandTechnique, LeftHand, ParsedNote, RightHand } from '../types';
import { TUNINGS } from '../constants';

/**
 * Semitone-to-Hui mapping based on guqin string physics.
 * 
 * Hui positions (fraction of string length from 岳山):
 *   Hui 13: 7/8, Hui 12: 5/6, Hui 11: 4/5, Hui 10: 3/4,
 *   Hui 9: 2/3, Hui 8: 3/5, Hui 7: 1/2, Hui 6: 2/5,
 *   Hui 5: 1/3, Hui 4: 1/4
 * 
 * Sub-positions use "X.Y" notation = from Hui X, Y/10 toward Hui (X+1).
 * Semitone = 12 × log2(1 / string_fraction).
 */
const HUI_OFFSETS: Record<number, string> = {
  1:  '十三外',  // m2  — just past Hui 13 toward nut
  2:  '十三',    // M2  — Hui 13 (7/8, ~2.3 semitones)
  3:  '十二',    // m3  — Hui 12 (5/6, ~3.2 semitones)
  4:  '十一',    // M3  — Hui 11 (4/5, ~3.9 semitones)
  5:  '十',      // P4  — Hui 10 (3/4, exact 5.0 semitones)
  6:  '九.五',   // TT  — between Hui 9 & 10
  7:  '九',      // P5  — Hui 9  (2/3, ~7.0 semitones)
  8:  '八.四',   // m6  — between Hui 8 & 9
  9:  '八',      // M6  — Hui 8  (3/5, ~8.8 semitones)
  10: '七.六',   // m7  — verified ✓
  11: '七.三',   // M7  — verified ✓
  12: '七',      // P8  — Hui 7  (1/2, exact 12.0 semitones)
  13: '六.七',   // m9  — between Hui 6 & 7
  14: '六.四',   // M9  — verified ✓
  15: '六.二',   // m10 — verified ✓
  16: '六',      // M10 — Hui 6  (2/5, ~15.9 semitones)
  17: '五.六',   // P11 — between Hui 5 & 6 (was incorrectly '五.九')
  18: '五.三',   // A11 — between Hui 5 & 6
  19: '五',      // P12 — Hui 5  (1/3, ~19.0 semitones)
  20: '四.八',   // m13 — between Hui 4 & 5
  21: '四.五',   // M13 — between Hui 4 & 5
  22: '四.三',   // m14 — between Hui 4 & 5
  23: '四.一',   // M14 — between Hui 4 & 5
  24: '四',      // P15 — Hui 4  (1/4, exact 24.0 semitones)
};

/**
 * Build a dynamic solfege→string map from the tuning's solfege string.
 * e.g. "5 6 1 2 3 5 6" → { '5': [1,6], '6': [2,7], '1': [3], '2': [4], '3': [5] }
 */
const buildSolfegeMap = (tuning: GuqinTuning): Record<string, number[]> => {
  const solfegeNotes = tuning.solfege.split(' '); // e.g. ['5','6','1','2','3','5','6']
  const map: Record<string, number[]> = {};
  solfegeNotes.forEach((note, index) => {
    if (!map[note]) map[note] = [];
    map[note].push(index + 1); // string numbers are 1-based
  });
  return map;
};

interface Position {
  string: number;
  hui: string;
  huiValue: number | null;
  technique: HandTechnique;
  score: number; // Lower is better
}

const CHINESE_NUMERALS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

const parseChineseInteger = (value: string): number | null => {
  if (!value) return null;
  if (value === '十') return 10;
  if (value.startsWith('十')) {
    const unit = CHINESE_NUMERALS[value.slice(1)];
    return unit ? 10 + unit : null;
  }
  const direct = CHINESE_NUMERALS[value];
  if (direct) return direct;
  const chars = value.split('');
  if (chars.length === 2 && chars[1] === '十') {
    const tens = CHINESE_NUMERALS[chars[0]];
    return tens ? tens * 10 : null;
  }
  if (chars.length === 3 && chars[1] === '十') {
    const tens = CHINESE_NUMERALS[chars[0]];
    const ones = CHINESE_NUMERALS[chars[2]];
    return tens && ones ? tens * 10 + ones : null;
  }
  return null;
};

const huiToDecimal = (hui: string): number | null => {
  if (!hui) return null;
  if (hui === '十三外') return 13.2;

  if (hui.includes('.')) {
    const [whole, fraction] = hui.split('.');
    const wholeValue = parseChineseInteger(whole);
    const fractionValue = parseChineseInteger(fraction);
    if (wholeValue == null || fractionValue == null) return null;
    return wholeValue + fractionValue / 10;
  }

  return parseChineseInteger(hui);
};

const chooseRightHand = (
  selected: Position,
  previousString: number | null,
  lastRightHand: RightHand,
  repeatedRightHandCount: number
): RightHand => {
  const isLowerRegion = selected.string <= 5;
  const movingToHigherString = previousString != null ? selected.string > previousString : false;
  const stringJump = previousString != null ? Math.abs(selected.string - previousString) : 0;
  const sameStringRepeat = previousString != null && selected.string === previousString;

  const preferredPair: [RightHand, RightHand] = isLowerRegion
    ? movingToHigherString
      ? [RightHand.Mo, RightHand.Gou]
      : [RightHand.Gou, RightHand.Mo]
    : movingToHigherString
      ? [RightHand.Tiao, RightHand.Ti]
      : [RightHand.Ti, RightHand.Tiao];

  if (lastRightHand === RightHand.None) {
    return preferredPair[0];
  }

  if (sameStringRepeat && repeatedRightHandCount === 0) {
    return lastRightHand;
  }

  if (stringJump >= 2) {
    return movingToHigherString
      ? isLowerRegion
        ? RightHand.Gou
        : RightHand.Tiao
      : isLowerRegion
        ? RightHand.Mo
        : RightHand.Ti;
  }

  if (lastRightHand === preferredPair[0] && repeatedRightHandCount >= 1) {
    return preferredPair[1];
  }

  if (lastRightHand === preferredPair[0]) {
    return preferredPair[1];
  }

  return preferredPair[0];
};

export const mapNotesToGuqin = (notes: ParsedNote[], tuningPitches: number[], tuning?: GuqinTuning): GuqinNote[] => {
  let lastString = 7; // Default start hint
  let lastHuiValue: number | null = null;
  let lastTechnique: HandTechnique = HandTechnique.Empty;
  let anchorHuiValue: number | null = null;
  let lastRightHand: RightHand = RightHand.None;
  let repeatedRightHandCount = 0;
  let consecutiveSanCount = 0;

  // Build dynamic solfege map from the actual tuning
  const activeTuning = tuning || TUNINGS[0];
  const solfegeMap = buildSolfegeMap(activeTuning);

  const result: GuqinNote[] = [];
  let chordUsedStrings: Set<number> = new Set(); // Track strings used in current chord group

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    
    // Reset chord tracking when we hit a non-chord note
    if (!note.chord) {
        chordUsedStrings = new Set();
    }

    // 1. Pass through structural items
    if (note.isBarline || note.isDash || note.isRest) {
        result.push({
            originalNote: note,
            string: 0, hui: '', technique: HandTechnique.Empty,
            rightHand: RightHand.None, leftHand: LeftHand.None, isValid: true
        });
        if (note.isBarline || note.isRest || note.isDash) {
            lastRightHand = RightHand.None;
            repeatedRightHandCount = 0;
            consecutiveSanCount = 0;
        }
        if (note.isBarline) {
            lastTechnique = HandTechnique.Empty;
            lastHuiValue = null;
            anchorHuiValue = anchorHuiValue == null ? null : anchorHuiValue * 0.82;
        }
        continue;
    }

    const candidates: Position[] = [];
    const midi = note.absolutePitch;
    const jianpuNum = note.jianpu.number; // "1", "2", "3"...

    // --- STRATEGY A: Open String Match (San Yin) ---
    // Match by solfege number AND octave proximity to the open string pitch.
    // The jianpu octave tells us how many octaves away from the "central" range the note is.
    // Open strings should only match notes whose pitch class matches AND whose octave is
    // compatible (within ±1 octave of the open string's actual pitch).
    
    const openStringIndices = solfegeMap[jianpuNum];
    
    if (openStringIndices) {
        openStringIndices.forEach(strIdx => {
             const openMidi = tuningPitches[strIdx - 1];
             // Check if the note's pitch class matches the open string's pitch class
             // AND the note is within reasonable octave range (octave-equivalent match)
             const pitchClassMatch = (midi % 12) === (openMidi % 12);
             const octaveDiff = Math.abs(midi - openMidi);
             
             if (pitchClassMatch && octaveDiff <= 12) {
                 const exactMatch = midi === openMidi;
                 const dist = Math.abs(strIdx - lastString);
                 let score = exactMatch ? 1.35 : 6.0;
                 score += dist * (exactMatch ? 0.26 : 0.52);
                 if (!exactMatch) score += 0.65;
                 if (exactMatch && lastTechnique === HandTechnique.An) {
                     score -= 0.35;
                 } else if (lastTechnique === HandTechnique.An && anchorHuiValue != null) {
                     score += 0.85;
                 }
                 if (lastTechnique === HandTechnique.San) {
                     score += 0.55;
                 }
                 if (consecutiveSanCount >= 2) {
                     score += 1.5;
                 }
                 candidates.push({
                     string: strIdx,
                     hui: '',
                     huiValue: null,
                     technique: HandTechnique.San,
                     score
                 });
             }
        });
    }

    // --- STRATEGY B: Absolute Pitch Match (Stopped Strings) ---
    tuningPitches.forEach((openMidi, index) => {
        const stringNum = index + 1;
        
        // Exact Open String (Backup to Strategy A)
        if (midi === openMidi) {
             candidates.push({
                 string: stringNum,
                 hui: '',
                 huiValue: null,
                 technique: HandTechnique.San,
                 score: 1.85 + Math.abs(stringNum - lastString) * 0.42 + (consecutiveSanCount >= 2 ? 1.5 : 0)
             });
        }
        
        // Stopped positions
        const diff = midi - openMidi;
        if (diff > 0 && diff <= 24) {
             // Find Hui
             let matchedHui = '';
             let scorePenalty = 3.4;
             
             if (HUI_OFFSETS[diff]) {
                 matchedHui = HUI_OFFSETS[diff];
             } else {
                 // Fuzzy match closest hui
                 // This allows mapping pitches that are slightly off
                 const offsets = Object.keys(HUI_OFFSETS).map(Number);
                 const closest = offsets.reduce((prev, curr) => Math.abs(curr - diff) < Math.abs(prev - diff) ? curr : prev);
                 if (Math.abs(closest - diff) <= 1) {
                     matchedHui = HUI_OFFSETS[closest];
                     scorePenalty += 1.8; // Slight penalty for fuzzy match
                 }
             }

             if (matchedHui) {
                 const huiValue = huiToDecimal(matchedHui);
                 let score = scorePenalty;
                 score += Math.abs(stringNum - lastString) * 0.45;
                 if (huiValue != null && lastHuiValue != null) {
                     score += Math.abs(huiValue - lastHuiValue) * 0.75;
                     if (stringNum === lastString) {
                         const sameStringJump = Math.abs(huiValue - lastHuiValue);
                         if (sameStringJump >= 1.2) score += 2.0;
                         if (sameStringJump >= 1.8) score += 4.0;
                         if (sameStringJump >= 2.4) score += 7.0;
                     }
                 }
                 if (huiValue != null && anchorHuiValue != null) {
                     score += Math.abs(huiValue - anchorHuiValue) * 0.52;
                 }
                 if (lastTechnique === HandTechnique.San) {
                     score += 0.4;
                 }
                 candidates.push({
                     string: stringNum,
                     hui: matchedHui,
                     huiValue,
                     technique: HandTechnique.An,
                     score
                 });
             }
        }
    });

    // --- SELECTION ---
    // Filter out strings already used in current chord group
    const availableCandidates = candidates.filter(c => !chordUsedStrings.has(c.string));
    const finalCandidates = availableCandidates.length > 0 ? availableCandidates : candidates;
    
    // Sort by Score
    finalCandidates.sort((a, b) => a.score - b.score);

    // If no candidate (weird pitch), fallback to a dummy "An" on string 7 or 1
    if (finalCandidates.length === 0) {
        finalCandidates.push({ string: 7, hui: '外', huiValue: null, technique: HandTechnique.An, score: 999 });
    }

    let selected = finalCandidates[0];
    if (selected.string === lastString && selected.huiValue != null && lastHuiValue != null) {
        const sameStringJump = Math.abs(selected.huiValue - lastHuiValue);
        if (sameStringJump >= 2.4) {
            const alternate = finalCandidates.find(
                (candidate) =>
                    candidate.string !== lastString &&
                    candidate.score <= selected.score + 2 &&
                    candidate.technique === selected.technique
            );
            if (alternate) {
                selected = alternate;
            }
        }
    }
    chordUsedStrings.add(selected.string);

    // --- HAND LOGIC ---
    const rh = chooseRightHand(selected, lastString, lastRightHand, repeatedRightHandCount);
    
    let lh = LeftHand.None;
    if (selected.technique === HandTechnique.An) {
        if ((selected.huiValue ?? 0) >= 9) {
            lh = LeftHand.Da; // Thumb for lower positions
        } else if ((selected.huiValue ?? 0) >= 7) {
            lh = LeftHand.Ming;
        } else {
            lh = LeftHand.Zhong;
        }
    }

    if (rh === lastRightHand) {
        repeatedRightHandCount += 1;
    } else {
        repeatedRightHandCount = 0;
    }
    lastRightHand = rh;
    lastString = selected.string;
    lastTechnique = selected.technique;
    lastHuiValue = selected.huiValue;
    consecutiveSanCount = selected.technique === HandTechnique.San ? consecutiveSanCount + 1 : 0;
    if (selected.huiValue != null) {
        anchorHuiValue = anchorHuiValue == null ? selected.huiValue : anchorHuiValue * 0.65 + selected.huiValue * 0.35;
    } else if (selected.technique === HandTechnique.San && anchorHuiValue != null) {
        anchorHuiValue *= 0.92;
    }

    result.push({
      originalNote: note,
      string: selected.string,
      hui: selected.hui,
      huiDecimal: selected.huiValue ?? undefined,
      technique: selected.technique,
      rightHand: rh,
      leftHand: lh,
      isValid: true
    });
  }
  
  return result;
};
