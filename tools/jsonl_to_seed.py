import json
from pathlib import Path

src = Path('data/epub-import/qiutujianshen')
out = Path('cloudfunctions/library/seed')
out.mkdir(parents=True, exist_ok=True)

def jsonl_to_array(path):
    items=[]
    for line in path.read_text(encoding='utf-8').splitlines():
        line=line.strip()
        if not line:
            continue
        items.append(json.loads(line))
    return items

books = jsonl_to_array(src/'books.compat.jsonl')
chapters = jsonl_to_array(src/'book_chapters.compat.jsonl')

(out/'books.qiutu.json').write_text(json.dumps(books, ensure_ascii=False, indent=2), encoding='utf-8')
(out/'book_chapters.qiutu.json').write_text(json.dumps(chapters, ensure_ascii=False, indent=2), encoding='utf-8')
print(len(books), len(chapters))
