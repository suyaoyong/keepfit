import argparse
import html
import json
import re
import shutil
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET


def ns_tag(tag):
    return tag.split('}', 1)[-1] if '}' in tag else tag


def find_rootfile(zf):
    data = zf.read('META-INF/container.xml')
    root = ET.fromstring(data)
    for elem in root.iter():
        if ns_tag(elem.tag) == 'rootfile':
            return elem.attrib.get('full-path')
    raise RuntimeError('cannot find rootfile in container.xml')


def parse_opf(zf, opf_path):
    raw = zf.read(opf_path)
    root = ET.fromstring(raw)

    title = ''
    for e in root.iter():
        t = ns_tag(e.tag)
        if t == 'title' and (e.text or '').strip():
            title = (e.text or '').strip()
            break

    manifest = {}
    spine = []
    cover_id_from_meta = ''
    cover_href = ''

    for e in root.iter():
        t = ns_tag(e.tag)
        if t == 'item':
            item_id = e.attrib.get('id', '')
            href = e.attrib.get('href', '')
            media_type = e.attrib.get('media-type', '')
            properties = e.attrib.get('properties', '')
            if item_id and href:
                manifest[item_id] = {
                    'href': href,
                    'media_type': media_type,
                    'properties': properties,
                }
                if 'cover-image' in properties and not cover_href:
                    cover_href = href
        elif t == 'itemref':
            idref = e.attrib.get('idref', '')
            if idref:
                spine.append(idref)
        elif t == 'meta':
            if (e.attrib.get('name', '') or '').lower() == 'cover':
                cover_id_from_meta = e.attrib.get('content', '')

    if cover_id_from_meta and not cover_href:
        cover_item = manifest.get(cover_id_from_meta)
        if cover_item:
            cover_href = cover_item.get('href', '')

    return title, manifest, spine, cover_href


def resolve_zip_path(zf, base, href):
    path = (base / href).as_posix()
    if path in zf.namelist():
        return path
    candidates = [
        p for p in zf.namelist()
        if p.endswith('/' + Path(href).name) or p == href or p.endswith('/' + path)
    ]
    return candidates[0] if candidates else None


def decode_chapter_content(raw):
    # Keep UTF-8 as canonical encoding for this book.
    # Only fallback when UTF-8 strict decode really fails.
    try:
        return raw.decode('utf-8')
    except Exception:
        pass

    try:
        return raw.decode('utf-8-sig')
    except Exception:
        pass

    try:
        return raw.decode('gb18030')
    except Exception:
        pass

    return raw.decode('utf-8', errors='ignore')


def clean_text_from_html(content):
    content = re.sub(r'<script[\s\S]*?</script>', '', content, flags=re.IGNORECASE)
    content = re.sub(r'<style[\s\S]*?</style>', '', content, flags=re.IGNORECASE)
    content = re.sub(r'<br\s*/?>', '\n', content, flags=re.IGNORECASE)
    content = re.sub(r'</p\s*>', '\n', content, flags=re.IGNORECASE)

    text = re.sub(r'<[^>]+>', '', content)
    text = html.unescape(text)

    lines = [ln.strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]

    cleaned = []
    for ln in lines:
        lower = ln.lower()
        if lower in ('cover page', 'title page'):
            continue
        if lower.startswith('@page'):
            continue
        if '{' in ln and '}' in ln and ':' in ln:
            continue
        cleaned.append(ln)

    return cleaned


def extract_title_from_content(content, fallback):
    for pat in (
        r'<h1[^>]*>([\s\S]*?)</h1>',
        r'<h2[^>]*>([\s\S]*?)</h2>',
        r'<title[^>]*>([\s\S]*?)</title>',
    ):
        m = re.search(pat, content, flags=re.IGNORECASE)
        if m:
            t = re.sub(r'<[^>]+>', '', m.group(1)).strip()
            t = html.unescape(t)
            if t:
                return t
    return fallback


def to_content_html(lines):
    if not lines:
        return '<p>(No content)</p>'
    return ''.join(f'<p>{html.escape(ln)}</p>' for ln in lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--epub', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--book-id', default='qiutujianshen')
    parser.add_argument('--seed-cover-out', default='cloudfunctions/library/seed/qiutu-cover.jpg')
    args = parser.parse_args()

    epub_path = Path(args.epub)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(epub_path, 'r') as zf:
        opf_path = find_rootfile(zf)
        title, manifest, spine, cover_href = parse_opf(zf, opf_path)
        base = Path(opf_path).parent

        cover_path_local = None
        if cover_href:
            cover_path = resolve_zip_path(zf, base, cover_href)
            if cover_path:
                cover_raw = zf.read(cover_path)
                suffix = Path(cover_path).suffix.lower() or '.jpg'
                cover_filename = f'{args.book_id}-cover{suffix}'
                cover_path_local = out_dir / cover_filename
                cover_path_local.write_bytes(cover_raw)

        chapters = []
        chapter_no = 0

        for idref in spine:
            item = manifest.get(idref)
            if not item:
                continue

            media_type = item.get('media_type', '')
            href = item.get('href', '')
            if media_type not in ('application/xhtml+xml', 'text/html') and not href.lower().endswith(('.xhtml', '.html', '.htm')):
                continue

            chapter_path = resolve_zip_path(zf, base, href)
            if not chapter_path:
                continue

            raw = zf.read(chapter_path)
            content = decode_chapter_content(raw)
            lines = clean_text_from_html(content)
            joined = ''.join(lines)

            if len(joined) < 80:
                continue

            chapter_no += 1
            fallback = f'Chapter {chapter_no}'
            chapter_title = extract_title_from_content(content, fallback)
            content_html = to_content_html(lines)

            chapters.append({
                'bookId': args.book_id,
                'chapterNo': chapter_no,
                'chapterTitle': chapter_title,
                'contentHtml': content_html,
                'wordCount': len(joined),
            })

    if not chapters:
        raise RuntimeError('no chapters extracted from epub')

    book_title = title.strip() if title else epub_path.stem
    books = [{
        'bookId': args.book_id,
        'title': book_title,
        'author': '',
        'coverUrl': '',
        'intro': f'{book_title} (EPUB import)',
        'chapterCount': len(chapters),
        'status': 'ready',
    }]

    (out_dir / 'books.json').write_text(json.dumps(books, ensure_ascii=False, indent=2), encoding='utf-8')
    (out_dir / 'book_chapters.json').write_text(json.dumps(chapters, ensure_ascii=False, indent=2), encoding='utf-8')

    copied_seed_cover = ''
    if cover_path_local and args.seed_cover_out:
        dst = Path(args.seed_cover_out)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(cover_path_local, dst)
        copied_seed_cover = str(dst)

    print(f'OK: {book_title}')
    print(f'chapters: {len(chapters)}')
    print(f'cover: {cover_path_local.name if cover_path_local else "not found"}')
    if copied_seed_cover:
        print(f'seed_cover: {copied_seed_cover}')
    print(f'output: {out_dir}')


if __name__ == '__main__':
    main()