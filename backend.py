"""
MusicXML / JSON → 古琴减字谱 转换后端

使用 music21 进行 MusicXML 解析, 基于 MIDI 音高进行古琴定弦映射。
支持散音(open_string)和按音(pressed)两种减字谱布局。
"""

from flask import Flask, render_template, request, jsonify, send_file
from music21 import converter, note as m21note, chord as m21chord
import tempfile
import os
import logging
import time

# ====================================================================
#  日志配置
# ====================================================================
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
log = logging.getLogger('guqin')

app = Flask(__name__)

# ====================================================================
#  古琴正调 (Standard / F-key Tuning) — 可在此修改定弦
# ====================================================================

# 七弦散音 MIDI 编号
# 正调: C D F G A C D
OPEN_STRINGS_MIDI = {
    1: 48,   # 一弦 C3
    2: 50,   # 二弦 D3
    3: 53,   # 三弦 F3
    4: 55,   # 四弦 G3
    5: 57,   # 五弦 A3
    6: 60,   # 六弦 C4
    7: 62,   # 七弦 D4
}

NUM_TO_CN = {
    1: "一", 2: "二", 3: "三", 4: "四", 5: "五",
    6: "六", 7: "七", 8: "八", 9: "九", 10: "十",
    11: "十一", 12: "十二", 13: "十三",
}

# 按音徽位: (名称, 相对散音的半音偏移)
# 基于纯律近似到十二平均律
HUI_POSITIONS = [
    ("散",   0),
    ("十三", 2),    # ~大二度
    ("十二", 3),    # ~小三度
    ("十一", 4),    # ~大三度
    ("十",   5),    # 纯四度
    ("九",   7),    # 纯五度
    ("八",   9),    # 大六度
    ("七",  12),    # 八度
    ("六",  16),    # 八度+大三度
    ("五",  19),    # 八度+纯五度
    ("四",  24),    # 两个八度
]

# 演奏舒适度排序 (越小越优先)
HUI_COMFORT = {
    "散": 0, "十": 1, "九": 2, "十一": 3, "八": 4,
    "十二": 5, "七": 6, "十三": 7, "六": 8, "五": 9, "四": 10,
}

# F大调 pitch_class(0~11) → 简谱数字
# F=1, G=2, A=3, Bb=4, C=5, D=6, E=7
PC_TO_JIANPU = {5: 1, 7: 2, 9: 3, 10: 4, 0: 5, 2: 6, 4: 7}
PC_CHROMATIC = {1: "#5", 3: "#6", 6: "#1", 8: "#2", 11: "b5"}

# 简谱基准: F3 = MIDI 53 = 中音 do
JIANPU_BASE = 53

# 旧 JSON 格式兼容: F调简谱数字 → 中音 MIDI 基准
_JP_BASE = {1: 53, 2: 55, 3: 57, 4: 58, 5: 60, 6: 62, 7: 64}


# ====================================================================
#  音高 → 古琴位置映射
# ====================================================================

def _build_table():
    """构建 MIDI → [(弦号, 徽位, 是否散音)] 查找表"""
    t = {}
    for s, m in OPEN_STRINGS_MIDI.items():
        for h, semi in HUI_POSITIONS:
            midi = m + semi
            t.setdefault(midi, []).append({
                "string": s, "hui": h, "is_open": h == "散",
            })
    log.info("古琴映射表构建完成: 覆盖 %d 个 MIDI 音高 (范围 %d-%d)",
             len(t), min(t), max(t))
    return t


GUQIN_TABLE = _build_table()


def _best(candidates):
    """从候选位置中选最佳: 散音优先, 然后按舒适度排序"""
    return min(candidates, key=lambda c: (
        0 if c["is_open"] else 1,
        HUI_COMFORT.get(c["hui"], 99),
    ))


def find_position(midi):
    """
    MIDI 音高 → 古琴位置
    返回 (position_dict, offset), offset=0 为精确匹配, ±N 为近似
    """
    if midi in GUQIN_TABLE:
        pos = _best(GUQIN_TABLE[midi])
        log.debug("MIDI %d → 精确匹配: %s弦 %s", midi, NUM_TO_CN[pos['string']], pos['hui'])
        return pos, 0
    for d in (1, -1, 2, -2):
        if midi + d in GUQIN_TABLE:
            pos = _best(GUQIN_TABLE[midi + d])
            log.debug("MIDI %d → 近似匹配(偏移%+d): %s弦 %s", midi, d, NUM_TO_CN[pos['string']], pos['hui'])
            return pos, d
    log.warning("MIDI %d → 无法映射 (超出古琴音域)", midi)
    return None, None


def midi_to_jianpu(midi):
    """MIDI → F大调简谱字符串 (带八度上下点)"""
    pc = midi % 12
    if pc in PC_TO_JIANPU:
        s = str(PC_TO_JIANPU[pc])
    elif pc in PC_CHROMATIC:
        s = PC_CHROMATIC[pc]
    else:
        return "?"
    o = (midi - JIANPU_BASE) // 12
    if o < 0:
        s += "\u0323" * abs(o)   # 下点 (combining dot below)
    elif o > 0:
        s += "\u0307" * o        # 上点 (combining dot above)
    return s


# ====================================================================
#  MusicXML 解析 (使用 music21)
# ====================================================================

def parse_musicxml(xml_content):
    """
    使用 music21 解析 MusicXML 字符串.
    自动处理升降号、和弦、多个声部等复杂情况.
    返回 (events_list, meta_dict).
    """
    log.info("开始解析 MusicXML (长度: %d 字符)", len(xml_content))
    t0 = time.time()

    # 写入临时文件, 确保各平台兼容
    with tempfile.NamedTemporaryFile(
        mode='w', suffix='.musicxml', delete=False, encoding='utf-8'
    ) as f:
        f.write(xml_content)
        tmp = f.name
    log.debug("临时文件: %s", tmp)

    try:
        score = converter.parse(tmp)
    except Exception as e:
        log.error("music21 解析失败: %s", e, exc_info=True)
        raise
    finally:
        os.unlink(tmp)

    elapsed = time.time() - t0
    log.info("music21 解析完成 (耗时 %.2fs)", elapsed)

    # 提取元数据
    meta = {"title": "古琴谱"}
    if score.metadata:
        meta["title"] = (
            score.metadata.title
            or getattr(score.metadata, 'movementName', None)
            or "古琴谱"
        )
    log.info("乐曲标题: %s", meta['title'])

    if not score.parts:
        log.warning("乐谱中没有找到任何声部 (parts)")
        return [], meta

    log.info("声部数量: %d, 使用第一声部: %s",
             len(score.parts), score.parts[0].partName or 'Part 1')

    # 取第一个声部 (多声部/多Staff情况下只取Part 1)
    part = score.parts[0]
    events, prev_m = [], None
    note_count, rest_count, chord_count = 0, 0, 0

    for elem in part.flat.notesAndRests:
        # 小节线
        mn = elem.measureNumber
        if mn != prev_m:
            if prev_m is not None:
                events.append({"type": "bar_line"})
            prev_m = mn

        # 休止符
        if isinstance(elem, m21note.Rest):
            rest_count += 1
            events.append({
                "type": "rest",
                "duration": float(elem.quarterLength),
            })
            continue

        # 和弦 → 取最高音 (旋律音通常在顶部)
        if isinstance(elem, m21chord.Chord):
            chord_count += 1
            top = max(elem.pitches, key=lambda p: p.midi)
            log.debug("小节%s 和弦 %s → 取最高音 %s (MIDI %d)",
                      mn, [p.nameWithOctave for p in elem.pitches],
                      top.nameWithOctave, top.midi)
            events.append({
                "type": "note",
                "midi": top.midi,
                "name": top.nameWithOctave,
                "duration": float(elem.quarterLength),
                "lyric": str(elem.lyric) if elem.lyric else "",
            })
            continue

        # 普通音符
        if isinstance(elem, m21note.Note):
            note_count += 1
            log.debug("小节%s 音符 %s (MIDI %d, 时值 %.2f)",
                      mn, elem.pitch.nameWithOctave,
                      elem.pitch.midi, float(elem.quarterLength))
            events.append({
                "type": "note",
                "midi": elem.pitch.midi,
                "name": elem.pitch.nameWithOctave,
                "duration": float(elem.quarterLength),
                "lyric": str(elem.lyric) if elem.lyric else "",
            })

    log.info("解析结果: %d 个音符, %d 个休止符, %d 个和弦, %d 个小节",
             note_count, rest_count, chord_count, prev_m or 0)
    return events, meta


# ====================================================================
#  事件 → 减字谱渲染数据
# ====================================================================

def events_to_render(events):
    """将音符事件列表转换为前端可渲染的减字谱数据"""
    log.info("开始转换减字谱 (共 %d 个事件)", len(events))
    queue = []
    stats = {"total": 0, "open": 0, "pressed": 0, "approx": 0, "unmapped": 0}

    for ev in events:
        if ev["type"] == "bar_line":
            queue.append({"type": "bar_line"})
            continue

        if ev["type"] == "rest":
            queue.append({"type": "rest", "duration": ev.get("duration", 1)})
            continue

        if ev["type"] != "note":
            continue

        stats["total"] += 1
        midi = ev["midi"]
        dur = ev.get("duration", 1.0)
        lyric = ev.get("lyric", "")
        jianpu = midi_to_jianpu(midi)

        pos, offset = find_position(midi)

        display = {
            "jianpu": jianpu,
            "lyric": lyric,
            "pitch_name": ev.get("name", ""),
        }
        if offset:
            display["approx"] = True
            stats["approx"] += 1

        # 超出古琴音域
        if pos is None:
            stats["unmapped"] += 1
            queue.append({
                "type": "guqin_char",
                "layout_mode": "unknown",
                "display_info": {**display, "warning": "超出音域"},
                "duration": dur,
                "components": {},
            })
            continue

        s = pos["string"]
        rh = "勹" if s >= 6 else "乚"   # 6-7弦用勾, 1-5弦用挑

        if pos["is_open"]:
            # === 散音 ===
            stats["open"] += 1
            queue.append({
                "type": "guqin_char",
                "layout_mode": "open_string",
                "display_info": display,
                "duration": dur,
                "components": {
                    "top": "艹",                    # 草字头 = 散音标记
                    "bottom_wrapper": rh,           # 右手技法
                    "bottom_inner": NUM_TO_CN[s],   # 弦号
                },
            })
        else:
            # === 按音 ===
            stats["pressed"] += 1
            queue.append({
                "type": "guqin_char",
                "layout_mode": "pressed",
                "display_info": display,
                "duration": dur,
                "components": {
                    "hui": pos["hui"],              # 徽位
                    "string": NUM_TO_CN[s],         # 弦号
                    "right_hand": rh,               # 右手技法
                    "left_hand": "名",              # 左手指法 (默认名指)
                },
            })

    log.info("减字谱转换完成: %s", stats)
    return queue, stats


# ====================================================================
#  路由
# ====================================================================

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/test/xianweng')
def test_xianweng():
    """提供仙翁操 JSON 测试数据"""
    return send_file('xianweng.json')


@app.route('/api/convert', methods=['POST'])
def convert():
    req_t0 = time.time()
    log.info("===== /api/convert 请求 =====")
    log.info("Content-Type: %s, 数据长度: %d bytes",
             request.content_type, request.content_length or 0)
    try:
        raw = request.data.decode('utf-8')

        if (raw.strip().startswith("<?xml")
                or "<score-partwise" in raw
                or "<score-timewise" in raw):
            # === MusicXML 输入 ===
            log.info("输入格式: MusicXML")
            events, meta = parse_musicxml(raw)
        else:
            # === JSON 输入 (兼容旧格式) ===
            log.info("输入格式: JSON (旧格式兼容)")
            data = request.get_json(force=True, silent=True) or {}
            raw_events = data.get("events", [])
            meta = data.get("meta", {"title": "古琴谱"})
            log.info("JSON 事件数: %d, 标题: %s", len(raw_events), meta.get('title'))
            events = []
            for e in raw_events:
                if e["type"] in ("bar_line", "rest"):
                    events.append(e)
                elif e["type"] == "note":
                    # 旧格式: F调简谱 pitch + octave → MIDI
                    base = _JP_BASE.get(e.get("pitch", 1), 53)
                    midi = base + e.get("octave", 0) * 12
                    log.debug("旧格式转换: pitch=%s octave=%s → MIDI %d",
                              e.get('pitch'), e.get('octave'), midi)
                    events.append({
                        "type": "note",
                        "midi": midi,
                        "name": "",
                        "duration": e.get("duration", 1.0),
                        "lyric": e.get("lyric", ""),
                    })

        queue, stats = events_to_render(events)
        elapsed = time.time() - req_t0
        log.info("请求处理完成 (总耗时 %.2fs, render_queue 长度: %d)", elapsed, len(queue))
        return jsonify({
            "song_info": meta,
            "render_queue": queue,
            "stats": stats,
        })

    except Exception as e:
        log.error("转换失败: %s", e, exc_info=True)
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    log.info("启动 Flask 服务器 (port=5002, debug=True)")
    log.info("古琴映射表: %d 个 MIDI 音高, 范围 MIDI %d-%d",
             len(GUQIN_TABLE), min(GUQIN_TABLE), max(GUQIN_TABLE))
    app.run(debug=True, port=5002)
