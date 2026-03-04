import { GuqinNote, HandTechnique, LeftHand, RightHand } from '../types';

/**
 * Convert a GuqinNote into a text string that the WangJiJianZiPuKaiTi font
 * renders as a proper 减字谱 (jianzipu) character.
 *
 * Font encoding (from http://www.wjjzp.com/jzpWeb/index.html):
 *   [modifier] [left_finger] [hui_position] [right_hand_technique] [string_number] + SPACE
 *
 * Examples:
 *   散挑七   → open string, tiao, string 7
 *   大九挑二  → thumb at hui 9, tiao, string 2
 *   名七六勾五 → ming at hui 7.6, gou, string 5
 *   泛名九挑六 → harmonic, ming, hui 9, tiao, string 6
 *
 * ⚠️ Key rule: each character MUST end with a SPACE to trigger OpenType composition.
 */

const STRING_NUM: Record<number, string> = {
  1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七',
};

/**
 * Convert internal hui notation (e.g. "七.六", "十三", "十三外")
 * to the font-compatible format.
 *
 * Disambiguation rules (from the font website):
 *   "十二"  → font renders as 十徽二分 (hui 10, sub 2)
 *   "十二徽" → font renders as 十二徽 (hui 12)
 * So hui 11/12/13 without sub-position need "徽" suffix.
 */
const convertHuiForFont = (hui: string): string => {
  if (!hui) return '';

  // "十三外" → just "外"
  if (hui === '十三外') return '外';

  // Remove the dot from sub-positions: "七.六" → "七六"
  let result = hui.replace('.', '');

  // Disambiguate hui 11, 12, 13 (exact positions, no sub):
  // Without 徽, the font treats "十一" as "十(hui10) + 一(sub1)"
  if (result === '十一') return '十一徽';
  if (result === '十二') return '十二徽';
  if (result === '十三') return '十三徽';

  return result;
};

/**
 * Build the font input text for a single GuqinNote.
 * Returns the text string (with trailing space) that the font will render as a jianzipu character.
 * Returns null for structural elements (barlines, dashes, rests) that are not rendered by the font.
 */
export const buildJianzipuText = (note: GuqinNote): string | null => {
  const orig = note.originalNote;

  // Structural elements are not jianzipu characters
  if (orig.isBarline || orig.isDash || orig.isRest) return null;
  if (!note.isValid || note.string === 0) return null;

  const stringText = STRING_NUM[note.string] || '';
  const rhText = note.rightHand !== RightHand.None ? note.rightHand : '';
  const huiText = convertHuiForFont(note.hui);

  let parts: string[] = [];

  switch (note.technique) {
    case HandTechnique.San:
      // 散音: 散 + 右手 + 弦号
      parts = ['散', rhText, stringText];
      break;

    case HandTechnique.Fan:
      // 泛音: 泛 + 左手 + 徽位 + 右手 + 弦号
      parts = ['泛'];
      if (note.leftHand !== LeftHand.None) parts.push(note.leftHand);
      if (huiText) parts.push(huiText);
      parts.push(rhText, stringText);
      break;

    case HandTechnique.An:
    default:
      // 按音: 左手 + 徽位 + 右手 + 弦号
      if (note.leftHand !== LeftHand.None) parts.push(note.leftHand);
      if (huiText) parts.push(huiText);
      parts.push(rhText, stringText);
      break;
  }

  // Filter empty strings, join, and append mandatory space
  const text = parts.filter(Boolean).join('');
  return text ? text + ' ' : null;
};

/**
 * Build a chord (撮/拨) jianzipu text for two simultaneous GuqinNote[].
 *
 * Font encoding for chords (from the website):
 *   撮 + [upper note: left_finger + hui + string] + [lower note: 散/left_finger + hui + string]
 *
 * Examples:
 *   撮大九六散三       → cuo: thumb at hui 9, string 6 + open string 3
 *   撮名七五散一       → cuo: ming at hui 7, string 5 + open string 1
 *
 * The font automatically renders the upper note in the top half
 * and the lower note in the bottom half of the 撮 character.
 */
export const buildChordJianzipuText = (notes: GuqinNote[]): string | null => {
  if (notes.length < 2) return null;

  // Sort by string number: lower string number = lower pitch (thicker string)
  const sorted = [...notes].sort((a, b) => a.string - b.string);
  const upper = sorted[0]; // Lower string number = bass note = upper part of 撮
  const lower = sorted[sorted.length - 1]; // Higher string number = melody = lower part

  // Build upper note part (left hand + hui + string number, no right-hand technique)
  const buildNotePart = (note: GuqinNote): string => {
    const stringText = STRING_NUM[note.string] || '';
    const huiText = convertHuiForFont(note.hui);

    if (note.technique === HandTechnique.San) {
      return '散' + stringText;
    } else if (note.technique === HandTechnique.Fan) {
      let p = '泛';
      if (note.leftHand !== LeftHand.None) p += note.leftHand;
      if (huiText) p += huiText;
      p += stringText;
      return p;
    } else {
      let p = '';
      if (note.leftHand !== LeftHand.None) p += note.leftHand;
      if (huiText) p += huiText;
      p += stringText;
      return p;
    }
  };

  const upperPart = buildNotePart(upper);
  const lowerPart = buildNotePart(lower);

  return `撮${upperPart}${lowerPart} `;
};
