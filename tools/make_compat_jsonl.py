import json
from pathlib import Path

base = Path('data/epub-import/qiutujianshen')

# validate existing jsonl
for f in ['books.jsonl','book_chapters.jsonl']:
    p = base / f
    with p.open('r', encoding='utf-8') as fp:
        for i, line in enumerate(fp, 1):
            line = line.strip()
            if not line:
                continue
            json.loads(line)
print('validate ok')

books = [
  {
    'bookId': 'qiutujianshen',
    'title': 'Qiutu Fitness',
    'author': '',
    'coverUrl': '',
    'intro': 'EPUB import',
    'chapterCount': 17,
    'status': 'ready'
  }
]

with (base / 'books.compat.jsonl').open('w', encoding='utf-8', newline='\n') as f:
    for item in books:
        f.write(json.dumps(item, ensure_ascii=True, separators=(',', ':')) + '\n')

# Also create wrapped docs variant in case console expects "_id"-free strict object only
chapters = []
for line in (base / 'book_chapters.jsonl').read_text(encoding='utf-8').splitlines():
    if not line.strip():
        continue
    obj = json.loads(line)
    # remove possible risky chars in title for compatibility
    obj['chapterTitle'] = str(obj.get('chapterTitle','')).replace('·','-')
    chapters.append(obj)

with (base / 'book_chapters.compat.jsonl').open('w', encoding='utf-8', newline='\n') as f:
    for obj in chapters:
        f.write(json.dumps(obj, ensure_ascii=True, separators=(',', ':')) + '\n')

print('generated compat files')
