# 泛音（Fan Yin）识别逻辑设计

## 核心原理

古琴泛音只在**弦长整数比位置**（徽位）产生，泛音频率 = 空弦基频 × 整数倍（谐波序列）。

### 徽位与谐波对应表

| 徽位 | 弦长比 | 谐波序号 | 与空弦音程 | 纯律 cents | 平均律 cents | 差值 |
|------|--------|---------|-----------|-----------|-------------|------|
| 七徽 | 1/2 | 2nd | 八度 (P8) | 1200.0 | 1200.0 | 0 |
| 五徽 / 九徽 | 1/3, 2/3 | 3rd | 八度+五度 (P12) | 1902.0 | 1900.0 | +2.0 |
| 四徽 / 十徽 | 1/4, 3/4 | 4th | 两个八度 (P15) | 2400.0 | 2400.0 | 0 |
| 三徽 / 十一徽 | 1/5, 4/5 | 5th | 两个八度+大三度 | 2786.3 | 2800.0 | -13.7 |
| 二徽 / 十二徽 | 1/6, 5/6 | 6th | 两个八度+五度 | 3102.0 | 3100.0 | +2.0 |
| 一徽 / 十三徽 | 1/7, 6/7 | 7th | ~两个八度+小七度 | 3368.8 | 3300.0 | +68.8 (罕用) |

> **说明**：第 7 谐波（一徽/十三徽）与十二平均律偏差较大（~69 cents），实际琴曲中极少使用。

## 识别算法

### 伪代码

```
对于每个音符 midi:
  candidates = []

  遍历 7 根弦 (string = 1..7):
    openMidi = tuningPitches[string]

    对于每个谐波 n = 2, 3, 4, 5, 6:
      harmonicMidi = openMidi + 12 * log2(n)
      // 纯律频率对应的 MIDI 值（非整数）

      if |round(harmonicMidi) - midi| == 0:
        // 十二平均律量化后匹配
        score = baseScore(n, string, context)
        candidates.push({
          string,
          hui: HARMONIC_HUI[n],  // 可能有多个徽位
          technique: Fan,
          harmonicOrder: n,
          score
        })

  if candidates.length > 0:
    选择 score 最低的候选
```

### 谐波序号 → 徽位映射

```typescript
const HARMONIC_HUI: Record<number, string[]> = {
  2: ['七'],           // 1/2 — 所有弦均可
  3: ['五', '九'],     // 1/3, 2/3
  4: ['四', '十'],     // 1/4, 3/4
  5: ['三', '十一'],   // 1/5, 4/5
  6: ['二', '十二'],   // 1/6, 5/6
};
```

每个谐波有多个等效徽位（对称点）。选择规则：
- 优先选离前一个泛音位置近的徽位（减少左手移动）
- 走手泛音（连续同弦泛音滑奏）时保持同弦

### 评分函数 `baseScore(n, string, context)`

```
score = 0

// 1. 谐波阶数偏好：低阶谐波音色更纯净
score += (n - 2) * 2   // 2nd=0, 3rd=2, 4th=4, 5th=6, 6th=8

// 2. 弦距惩罚：与上一个音的弦距
score += |string - lastString| * 1.5

// 3. 上下文连续性奖励
if 前一个音也是泛音:
  score -= 5            // 泛音段落连续性奖励
  if 前一个音同弦:
    score -= 3          // 同弦泛音额外奖励（走手泛音可能）

// 4. 与按音候选比较的全局偏好
// 泛音基础分设为负数，使其在同等条件下优先于按音
score -= 3
```

## 关键决策点

### 1. 泛音 vs 按音：如何选择？

当一个音**同时**可以用泛音和按音弹出时，需要决策：

#### 方案 A：MusicXML 标记优先（推荐）

MusicXML 的 `<technical>` 元素可能包含 `<harmonic>` 标记：

```xml
<note>
  <pitch><step>C</step><octave>5</octave></pitch>
  <notations>
    <technical>
      <harmonic>
        <natural/>
      </harmonic>
    </technical>
  </notations>
</note>
```

如果原谱标注了 `<harmonic>`，直接标记为泛音，不需要猜测。

#### 方案 B：上下文推断

如果 MusicXML 没有 `<harmonic>` 标记（常见情况），则通过上下文推断：

1. **连续泛音检测**：先对所有音符做一遍"泛音可行性"扫描，标记每个音是否*可以*用泛音弹出。如果连续 3+ 个音都可以用泛音，则整段标记为泛音段落。
2. **音高范围**：泛音通常在较高音区（≥ 空弦八度以上）。如果音在空弦基频以下，不可能是泛音。
3. **乐句边界**：泛音段落通常在乐句开始/结束处出现（如《仙翁操》的泛音引子），可以借助小节线和休止符做边界检测。

#### 方案 C：用户手动标记

在 UI 上提供"泛音段落"标记工具，让用户选定一段音符强制标记为泛音。

**建议**：A + B 方案结合。先检查 XML 标记，没有标记时用上下文推断，同时提供 C 作为 fallback。

### 2. 同一泛音多弦选择

例：正调中，三弦七徽泛音 = C5，五弦九徽泛音也 = C5（如果五弦空弦 = C4）。

选择标准（按优先级）：
1. **同弦连续**：如果前后音都在同一根弦上做泛音，优先保持同弦
2. **弦距最近**：与前一个音的弦号之差最小
3. **低阶谐波优先**：2nd > 3rd > 4th > 5th > 6th（音色更纯净）
4. **避免弦冲突**：和弦中不能两个音用同一根弦

### 3. 纯律 vs 十二平均律

泛音基于**纯律**（谐波序列），但 MusicXML 的音高基于**十二平均律**。差异：

| 谐波 | 纯律音程 | 平均律音程 | 差值 (cents) |
|------|---------|-----------|-------------|
| 2nd | 1200.0 | 1200.0 | 0 |
| 3rd | 1902.0 | 1900.0 | +2.0 |
| 4th | 2400.0 | 2400.0 | 0 |
| **5th** | **2786.3** | **2800.0** | **-13.7** |
| 6th | 3102.0 | 3100.0 | +2.0 |

第 5 谐波（大三度）差 ~14 cents，但 MusicXML 量化到半音后，`round(openMidi + 12*log2(5))` 仍然会落在正确的 MIDI 音符上，所以**整数 MIDI 比较即可**，不需要 cents 级容差。

唯一例外：如果空弦基频本身就在半音边界附近（极罕见情况），可能导致 round 方向错误。建议保留 ±1 半音的 fallback 匹配。

## 实现计划

### 数据结构变更

```typescript
// types.ts 中可能需要新增
interface HarmonicCandidate {
  string: number;
  hui: string;        // 徽位名
  harmonicOrder: number; // 谐波序号 2-6
  score: number;
}

// GuqinNote 已有 technique: HandTechnique.Fan，无需改动
```

### 代码变更位置

1. **parser.ts**：在 `<note>` 解析中检测 `<technical><harmonic>` 标记，存入 `ParsedNote`
2. **mapper.ts**：在 `mapNotesToGuqin()` 中新增泛音候选生成逻辑（与现有 Strategy A/B 并列的 Strategy C）
3. **mapper.ts**：新增泛音段落连续性检测（两遍扫描：第一遍标记可行性，第二遍确认段落）
4. **constants.ts**：新增 `HARMONIC_HUI` 常量

### 实现步骤

1. 在 `ParsedNote` 中新增 `isHarmonic?: boolean` 字段
2. parser.ts 中检测 `<harmonic>` XML 标记
3. mapper.ts 中实现 `findHarmonicCandidates()` 函数
4. mapper.ts 中实现泛音段落连续性检测
5. 集成到主 `mapNotesToGuqin()` 流程
6. 用《仙翁操》泛音段测试验证
