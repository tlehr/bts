#!/usr/bin/env python3
"""Read cached announcement clips and create an offline tempo/listening report.

No synthesis, server requests, cache edits or automatic speed normalization.
Vowel groups are a rough syllable estimate, never a pronunciation verdict.
"""
import argparse
import array
import hashlib
import html
import json
import math
from pathlib import Path
import re
import shutil
import statistics
import subprocess
import sys
import wave

BTS = Path(__file__).resolve().parent.parent


def category(recipe):
    text = recipe['text']
    if re.match(r'^(Spiel|Runde) um Platz\b', text):
        return 'placement'
    if re.search(r'finale\b', text, re.I):
        return 'round'
    if text.startswith('Spielnummer '):
        return 'number'
    if text.startswith('Für Spielfeld '):
        return 'preparation_field'
    if re.match(r'^Bitte (melde dich|meldet euch)\b', text):
        return 'meetingpoint'
    if recipe.get('kind') in {'field_start', 'field_end'}:
        return 'field'
    if recipe.get('before') == 'Im ' and 'erwarten wir spannende Spiele' in recipe.get('after', ''):
        return 'discipline'
    return None


def measure(path):
    with wave.open(str(path), 'rb') as wav:
        if wav.getsampwidth() != 2 or wav.getnchannels() not in (1, 2) or wav.getcomptype() != 'NONE':
            raise ValueError('Expected PCM16 mono/stereo WAV')
        rate, channels, frames = wav.getframerate(), wav.getnchannels(), wav.getnframes()
        samples = array.array('h', wav.readframes(frames))
    if sys.byteorder != 'little':
        samples.byteswap()
    if not frames or len(samples) != frames * channels:
        raise ValueError('Missing or truncated PCM data')
    step = max(1, round(rate * .01))
    active = []
    for offset in range(0, frames, step):
        block = samples[offset * channels:min(frames, offset + step) * channels]
        rms = math.sqrt(sum(value * value for value in block) / len(block)) / 32768
        peak = max(abs(value) for value in block) / 32768
        active.append(rms > 10 ** (-48 / 20) or peak > 10 ** (-38 / 20))
    positions = [i for i, value in enumerate(active) if value]
    if not positions:
        raise ValueError('No audible signal')
    first, last = positions[0], positions[-1]
    gaps, start = [], None
    for i in range(first, last + 1):
        if not active[i] and start is None:
            start = i
        elif active[i] and start is not None:
            if (i - start) * step / rate >= .08:
                gaps.append(round((i - start) * step * 1000 / rate, 1))
            start = None
    span = (min(frames, (last + 1) * step) - first * step) / rate
    active_seconds = sum(min(step, frames - i * step) for i in positions) / rate
    return {'duration_s': round(frames / rate, 4), 'speech_span_s': round(span, 4),
            'active_audio_s': round(active_seconds, 4), 'leading_quiet_ms': round(first * step * 1000 / rate, 1),
            'trailing_quiet_ms': round((frames - min(frames, (last + 1) * step)) * 1000 / rate, 1),
            'internal_pauses_ms': gaps}


def cached_rows(cache, voice=None):
    rows, skipped = [], []
    indexes = sorted(cache.glob('index-*.json'), key=lambda path: path.stat().st_mtime, reverse=True)
    if not indexes:
        raise ValueError('No speech-cache index found')
    index = json.loads(indexes[0].read_text())
    root = (cache / 'audio').resolve()
    seen = set()
    for record in index['records']:
        if not record.get('processed') or record.get('identity') != index.get('state', {}).get('identity'):
            continue
        part = record.get('part', '')
        if not part.startswith('~bts-context-v2~'):
            continue
        recipe = json.loads(part.split('~', 2)[2])
        group = category(recipe)
        if not group:
            continue
        path = (root / record['file']).resolve()
        if not path.is_relative_to(root):
            raise ValueError('Cache audio path escapes its directory')
        voices = {usage['voice'] for usage in record.get('usage', []) if usage.get('voice')}
        for current_voice in sorted(voices):
            if voice and current_voice != voice or (current_voice, record['audio_id']) in seen:
                continue
            seen.add((current_voice, record['audio_id']))
            try:
                if hashlib.sha256(path.read_bytes()).hexdigest() != record['sha256']:
                    raise ValueError('Cache WAV checksum mismatch')
                info = measure(path)
            except (OSError, ValueError, wave.Error) as error:
                skipped.append({'audio_id': record['audio_id'], 'reason': str(error)})
                continue
            rows.append({'voice': current_voice, 'group': group, 'audio_id': record['audio_id'],
                         'text': recipe['text'], 'source_text': recipe['before'] + recipe['text'] + recipe['after'],
                         'contextual': bool(recipe['before'] or recipe['after']), 'path': str(path), **info})
    texts = [row['text'] for row in rows]
    command = "const fs=require('fs'),{spellNumbers}=require('./bts/speech/numbers');process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(0,'utf8')).map(spellNumbers)))"
    spoken = json.loads(subprocess.check_output(['node', '-e', command], cwd=BTS, input=json.dumps(texts).encode()))
    for row, text in zip(rows, spoken):
        # German vowel groups are adequate for a coarse outlier screen. Names
        # are deliberately excluded; this must not drive automatic resampling.
        syllables = max(1, len(re.findall(r'[aeiouyäöü]+', text.lower())))
        row.update(spoken=text, estimated_syllables=syllables,
                   estimated_syllables_per_s=round(syllables / row['speech_span_s'], 3),
                   estimated_syllables_per_active_s=round(syllables / row['active_audio_s'], 3))
    return rows, skipped


def build_report(cache, output, voice=None):
    rows, skipped = cached_rows(cache, voice)
    baselines = {}
    for current in sorted({row['voice'] for row in rows}):
        references = [row['estimated_syllables_per_s'] for row in rows if row['voice'] == current and
                      row['group'] in {'field', 'number', 'discipline'} and row['estimated_syllables'] >= 3]
        if len(references) >= 3:
            baselines[current] = round(statistics.median(references), 3)
    output.mkdir(parents=True, exist_ok=False)
    (output / 'audio').mkdir()
    for row in rows:
        baseline = baselines.get(row['voice'])
        ratio = row['estimated_syllables_per_s'] / baseline if baseline else None
        row.update(relative_tempo=round(ratio, 3) if ratio else None,
                   review=bool(ratio is not None and ratio < .75 or max(row['internal_pauses_ms'], default=0) > 400))
    labels = {'placement': 'Platzierung', 'round': 'Runde', 'number': 'Spielnummer', 'field': 'Feld',
              'preparation_field': 'Feld in Vorbereitung', 'meetingpoint': 'Treffpunkt', 'discipline': 'Disziplin'}
    # Show every placement plus two comparators of each other kind per voice.
    selected, counts = [], {}
    for row in sorted(rows, key=lambda row: (row['group'] != 'placement', row['voice'], row['group'], row['text'])):
        key = (row['voice'], row['group'])
        counts[key] = counts.get(key, 0) + 1
        if row['group'] == 'placement' or counts[key] <= 2:
            selected.append(row)
    selected_ids = {row['audio_id'] for row in selected}
    for row in rows:
        source = row.pop('path')
        row['audio'] = None
        if row['audio_id'] in selected_ids:
            target = output / 'audio' / (row['audio_id'] + '.wav')
            shutil.copyfile(source, target)
            row['audio'] = 'audio/' + target.name
    report = {'version': 1, 'method': 'German vowel groups / speech span; 10ms RMS/peak silence screen',
              'limitations': 'Rough relative screen only. Prosody, pronunciation and numbers require listening. No automatic correction.',
              'reference_syllables_per_s': baselines, 'synthesis_requests': 0, 'cache_modified': False,
              'rows': rows, 'skipped': skipped}
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    table = []
    for row in selected:
        esc = html.escape
        source = '<details><summary>Kontextquelle</summary><p>' + esc(row['source_text']) + '</p></details>'
        table.append('<tr><td>' + esc(labels[row['group']]) + '<br>' + esc(row['voice']) + '</td><td><strong>' + esc(row['text']) +
                     '</strong><br>' + ('Mit Kontext' if row['contextual'] else 'Isoliert erzeugt') + source + '</td><td>' +
                     f"{row['duration_s']:.2f} s<br>{row['estimated_syllables_per_s']:.2f} geschätzte Silben/s<br>" +
                     f"Längste innere Pause: {max(row['internal_pauses_ms'], default=0):.0f} ms<br>" +
                     ('Tempo prüfen' if row['review'] else 'Vergleich') + '</td><td><audio controls preload="none" src="' +
                     esc(row['audio']) + '"></audio><label>Hörtempo <select>' + ''.join('<option value="' + str(rate) + '">' +
                     str(rate).replace('.', ',') + '×</option>' for rate in [1, 1.1, 1.2, 1.3, 1.4, 1.5]) + '</select></label></td></tr>')
    page = '''<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BTS · Tempo-Prüfung</title><style>body{font:16px/1.5 system-ui;max-width:1400px;margin:32px auto;padding:0 20px;color:#243942}table{width:100%;border-collapse:collapse}td,th{text-align:left;vertical-align:top;border-bottom:1px solid #ddd;padding:14px}audio{max-width:100%;display:block}label{display:block}details{font-size:13px}summary{cursor:pointer}@media(max-width:700px){tr,td{display:block}thead{display:none}}</style>
<h1>Tempo der Ansagebausteine prüfen</h1><p>Originale aus dem BTS-Cache. Das Hörtempo gilt nur auf dieser Seite und erhält die Tonhöhe. Aufnahmen und produktive Wiedergabe bleiben unverändert. Pro Stimme werden Feld-, Spielnummern- und Disziplinbausteine als Vergleich verwendet.</p>
<p>Silbenzahlen und Stille sind grob geschätzt. Ein Hinweis „Tempo prüfen“ ist ein Anlass zum Anhören, kein Aussprachefehler. Kurze Wörter, Zahlen und Satzmelodie lassen sich durch die Messzahl allein nicht angleichen.</p>
<p><a href="report.json">Alle Messwerte als JSON</a></p><table><thead><tr><th>Baustein</th><th>Text und Quelle</th><th>Messung</th><th>Hörvergleich</th></tr></thead><tbody>'''
    page += ''.join(table) + '''</tbody></table><script>document.querySelectorAll('select').forEach(select=>{select.addEventListener('change',()=>{const audio=select.closest('td').querySelector('audio');audio.preservesPitch=true;audio.playbackRate=Number(select.value)})});document.querySelectorAll('audio').forEach(audio=>audio.addEventListener('play',()=>document.querySelectorAll('audio').forEach(other=>{if(other!==audio)other.pause()})));</script></html>'''
    (output / 'index.html').write_text(page)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=BTS / 'data/speech-cache')
    parser.add_argument('--output', type=Path, required=True, help='New output directory; existing reports are never overwritten')
    parser.add_argument('--voice', choices=['hallensprecher', 'hallensprecherin'])
    args = parser.parse_args()
    report = build_report(args.cache, args.output, args.voice)
    print(json.dumps({'clips': len(report['rows']), 'review': sum(row['review'] for row in report['rows']),
                      'skipped': len(report['skipped']), 'page': str(args.output / 'index.html')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
