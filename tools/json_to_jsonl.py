import json
from pathlib import Path

base = Path('data/epub-import/qiutujianshen')
for name in ['books', 'book_chapters']:
    arr = json.loads((base / f'{name}.json').read_text(encoding='utf-8'))
    out = base / f'{name}.jsonl'
    with out.open('w', encoding='utf-8', newline='\n') as f:
        for item in arr:
            f.write(json.dumps(item, ensure_ascii=False) + '\n')
    print(name, len(arr), out)
