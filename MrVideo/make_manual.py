# make_manual.py — 把 README.md 轉成獨立的 manual.html（操作手冊，雙擊即可用瀏覽器閱讀）
# 用法：python make_manual.py  （於 installer/ 目錄下執行，輸出到 ../manual.html）
import re
import html
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'README.md')
DST = os.path.join(ROOT, 'manual.html')

CSS = """
:root{color-scheme:light dark}
body{font-family:"Microsoft JhengHei","Noto Sans TC",sans-serif;line-height:1.75;
  max-width:860px;margin:0 auto;padding:32px 20px 60px;color:#24292f;background:#fff}
@media (prefers-color-scheme:dark){body{color:#e6edf3;background:#0d1117}
  table th{background:#21262d}code{background:#343942}pre{background:#161b22}
  blockquote{border-color:#3b434b;color:#9da7b3}hr{border-color:#30363d}
  table td,table th{border-color:#30363d}a{color:#58a6ff}}
h1{font-size:1.9em;border-bottom:2px solid #d0d7de;padding-bottom:.3em}
h2{font-size:1.4em;border-bottom:1px solid #d0d7de;padding-bottom:.25em;margin-top:2em}
h3{font-size:1.15em;margin-top:1.6em}
a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}
code{background:#eff1f3;padding:.15em .4em;border-radius:5px;font-size:.92em;
  font-family:Consolas,monospace}
pre{background:#f6f8fa;padding:14px;border-radius:8px;overflow-x:auto;line-height:1.45}
pre code{background:none;padding:0}
blockquote{border-left:4px solid #d0d7de;margin:0;padding:.1em 1em;color:#57606a}
table{border-collapse:collapse;width:100%;margin:1em 0}
table td,table th{border:1px solid #d0d7de;padding:6px 12px;text-align:left}
table th{background:#f6f8fa}
hr{border:none;border-top:1px solid #d0d7de;margin:2em 0}
del{opacity:.6}
li{margin:.25em 0}
"""


def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    s = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'~~([^~]+)~~', r'<del>\1</del>', s)
    s = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', s)
    return s


def anchor_of(txt):
    # 比照 GitHub slug：去空白與標點，保留中英數字（TOC 連結為純中文，維持原字即可對上）
    t = txt.strip().replace(' ', '-')
    t = re.sub(r'[^\w一-鿿-]', '', t)
    return t.lower()


def convert(md):
    lines = md.replace('\r', '').split('\n')
    out = []
    i = 0
    in_code = False
    while i < len(lines):
        ln = lines[i]
        if ln.startswith('```'):
            out.append('<pre><code>' if not in_code else '</code></pre>')
            in_code = not in_code
            i += 1
            continue
        if in_code:
            out.append(html.escape(ln))
            i += 1
            continue
        stripped = ln.strip()
        if re.match(r'^(-{3,}|\*{3,})$', stripped):
            out.append('<hr>')
            i += 1
            continue
        m = re.match(r'^(#{1,6})\s+(.*)$', ln)
        if m:
            lvl = len(m.group(1))
            txt = m.group(2).strip()
            out.append('<h%d id="%s">%s</h%d>' % (lvl, anchor_of(txt), inline(txt), lvl))
            i += 1
            continue
        if stripped.startswith('|'):
            block = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                block.append(lines[i].strip())
                i += 1
            rows = [[c.strip() for c in r.strip('|').split('|')] for r in block]
            out.append('<table>')
            body_start = 0
            if len(rows) >= 2 and all(re.match(r'^:?-+:?$', c) for c in rows[1]):
                out.append('<thead><tr>' + ''.join('<th>%s</th>' % inline(c) for c in rows[0]) + '</tr></thead>')
                body_start = 2
            out.append('<tbody>')
            for r in rows[body_start:]:
                out.append('<tr>' + ''.join('<td>%s</td>' % inline(c) for c in r) + '</tr>')
            out.append('</tbody></table>')
            continue
        if stripped.startswith('>'):
            block = []
            while i < len(lines) and lines[i].strip().startswith('>'):
                block.append(lines[i].strip().lstrip('>').strip())
                i += 1
            out.append('<blockquote><p>%s</p></blockquote>' % '<br>'.join(inline(b) for b in block if b))
            continue
        m = re.match(r'^\s*[-*]\s+(.*)$', ln)
        if m:
            out.append('<ul>')
            while i < len(lines):
                m2 = re.match(r'^\s*[-*]\s+(.*)$', lines[i])
                if not m2:
                    break
                out.append('<li>%s</li>' % inline(m2.group(1)))
                i += 1
            out.append('</ul>')
            continue
        m = re.match(r'^\s*\d+\.\s+(.*)$', ln)
        if m:
            out.append('<ol>')
            while i < len(lines):
                m2 = re.match(r'^\s*\d+\.\s+(.*)$', lines[i])
                if not m2:
                    break
                out.append('<li>%s</li>' % inline(m2.group(1)))
                i += 1
            out.append('</ol>')
            continue
        if stripped == '':
            i += 1
            continue
        # 段落（連續行合併，行尾兩空格＝換行）
        block = []
        while i < len(lines) and lines[i].strip() != '' and not re.match(
                r'^(#{1,6}\s|```|\||>|\s*[-*]\s|\s*\d+\.\s|-{3,}$)', lines[i].strip()):
            block.append(inline(lines[i].strip()))
            i += 1
        out.append('<p>%s</p>' % '<br>'.join(block))
    return '\n'.join(out)


def main():
    with io.open(SRC, encoding='utf-8') as f:
        md = f.read()
    body = convert(md)
    page = ('<!DOCTYPE html>\n<html lang="zh-Hant">\n<head>\n<meta charset="UTF-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            '<title>影片先生 — 操作手冊</title>\n<style>' + CSS + '</style>\n</head>\n<body>\n'
            + body + '\n</body>\n</html>\n')
    with io.open(DST, 'w', encoding='utf-8') as f:
        f.write(page)
    print('written: manual.html (%d bytes)' % len(page.encode('utf-8')))


if __name__ == '__main__':
    main()
