import xml.etree.ElementTree as ET
from collections import Counter

tree = ET.parse('assist/小半.musicxml')
root = tree.getroot()

chord_sizes = Counter()
voice_dist = Counter()
pitch_range = {'min': 999, 'max': 0}
note_to_midi = {'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}

for measure in root.findall('.//measure'):
    notes = measure.findall('note')
    i = 0
    while i < len(notes):
        n = notes[i]
        voice = n.findtext('voice', '1')
        voice_dist[voice] += 1
        
        pitch = n.find('pitch')
        if pitch is not None:
            step = pitch.findtext('step','C')
            oct = int(pitch.findtext('octave','4'))
            alter = int(pitch.findtext('alter','0'))
            midi = (oct+1)*12 + note_to_midi[step] + alter
            pitch_range['min'] = min(pitch_range['min'], midi)
            pitch_range['max'] = max(pitch_range['max'], midi)
        
        size = 1
        while i+1 < len(notes) and notes[i+1].find('chord') is not None:
            i += 1
            size += 1
        chord_sizes[size] += 1
        i += 1

print('Total chord sizes:', dict(sorted(chord_sizes.items())))
print('Voices:', dict(sorted(voice_dist.items())))
print('Pitch range MIDI:', pitch_range)

print()
print('=== Sample large chords (3+ notes) ===')
count = 0
for measure in root.findall('.//measure'):
    mnum = measure.get('number')
    notes = measure.findall('note')
    i = 0
    while i < len(notes):
        n = notes[i]
        group = [n]
        while i+1 < len(notes) and notes[i+1].find('chord') is not None:
            i += 1
            group.append(notes[i])
        if len(group) >= 3 and count < 20:
            pitches = []
            for gn in group:
                p = gn.find('pitch')
                if p is not None:
                    s = p.findtext('step','')
                    o = p.findtext('octave','')
                    a = int(p.findtext('alter','0'))
                    acc = '#' if a>0 else 'b' if a<0 else ''
                    pitches.append(f'{s}{acc}{o}')
            voice = group[0].findtext('voice','?')
            staff = group[0].findtext('staff','?')
            print(f'  m{mnum} v{voice} s{staff}: {pitches}')
            count += 1
        i += 1

# Also show 2-note chords with big intervals
print()
print('=== Sample 2-note chords (interval analysis) ===')
count2 = 0
for measure in root.findall('.//measure'):
    mnum = measure.get('number')
    notes = measure.findall('note')
    i = 0
    while i < len(notes):
        n = notes[i]
        group = [n]
        while i+1 < len(notes) and notes[i+1].find('chord') is not None:
            i += 1
            group.append(notes[i])
        if len(group) == 2 and count2 < 15:
            midis = []
            names = []
            for gn in group:
                p = gn.find('pitch')
                if p is not None:
                    s = p.findtext('step','C')
                    o = int(p.findtext('octave','4'))
                    a = int(p.findtext('alter','0'))
                    acc = '#' if a>0 else 'b' if a<0 else ''
                    midi = (o+1)*12 + note_to_midi[s] + a
                    midis.append(midi)
                    names.append(f'{s}{acc}{o}')
            if len(midis) == 2:
                interval = abs(midis[1] - midis[0])
                voice = group[0].findtext('voice','?')
                print(f'  m{mnum} v{voice}: {names} interval={interval} semitones')
                count2 += 1
        i += 1
