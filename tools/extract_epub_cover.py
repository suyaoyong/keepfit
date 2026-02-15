import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

EPUB = Path('囚徒健身.epub')
OUT = Path('cloudfunctions/library/seed/qiutu-cover.jpg')


def tag(x):
    return x.split('}',1)[-1] if '}' in x else x

with zipfile.ZipFile(EPUB,'r') as zf:
    container = ET.fromstring(zf.read('META-INF/container.xml'))
    opf_path = None
    for e in container.iter():
        if tag(e.tag) == 'rootfile':
            opf_path = e.attrib.get('full-path')
            break
    if not opf_path:
        raise RuntimeError('opf not found')

    opf = ET.fromstring(zf.read(opf_path))
    base = Path(opf_path).parent

    manifest = {}
    meta_cover_id = None

    for e in opf.iter():
        t = tag(e.tag)
        if t == 'item':
            manifest[e.attrib.get('id','')] = e.attrib
        elif t == 'meta' and e.attrib.get('name') == 'cover':
            meta_cover_id = e.attrib.get('content')

    cover_href = None
    if meta_cover_id and meta_cover_id in manifest:
        cover_href = manifest[meta_cover_id].get('href')

    if not cover_href:
        for item_id, attr in manifest.items():
            href = (attr.get('href') or '').lower()
            props = (attr.get('properties') or '').lower()
            media = (attr.get('media-type') or '').lower()
            if 'cover-image' in props and media.startswith('image/'):
                cover_href = attr.get('href')
                break
            if 'cover' in item_id.lower() and media.startswith('image/'):
                cover_href = attr.get('href')
                break
            if href.endswith(('.jpg','.jpeg','.png')) and 'cover' in href:
                cover_href = attr.get('href')
                break

    if not cover_href:
        raise RuntimeError('cover href not found')

    cover_path = (base / cover_href).as_posix()
    if cover_path not in zf.namelist():
        cand = [n for n in zf.namelist() if n.endswith('/'+Path(cover_href).name) or n == cover_href]
        if not cand:
            raise RuntimeError(f'cover file missing: {cover_href}')
        cover_path = cand[0]

    data = zf.read(cover_path)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(data)

print(f'cover extracted: {OUT} ({OUT.stat().st_size} bytes)')
