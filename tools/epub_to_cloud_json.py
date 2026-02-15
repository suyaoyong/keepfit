import argparse
import hashlib
import html
import json
import re
import shutil
import zipfile
from html.parser import HTMLParser
from pathlib import Path
import xml.etree.ElementTree as ET


BLOCK_TAGS = {
    'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote',
    'section', 'article', 'header', 'footer', 'pre'
}


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
        if ns_tag(e.tag) == 'title' and (e.text or '').strip():
            title = (e.text or '').strip()
            break

    manifest = {}
    spine = []
    cover_id_from_meta = ''
    cover_href = ''

    for e in root.iter():
        tag = ns_tag(e.tag)
        if tag == 'item':
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
        elif tag == 'itemref':
            idref = e.attrib.get('idref', '')
            if idref:
                spine.append(idref)
        elif tag == 'meta':
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
    for enc in ('utf-8', 'utf-8-sig', 'gb18030', 'utf-16'):
        try:
            return raw.decode(enc)
        except Exception:
            pass
    return raw.decode('utf-8', errors='ignore')


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


def extract_body_html(content):
    content = re.sub(r'<script[\s\S]*?</script>', '', content, flags=re.IGNORECASE)
    content = re.sub(r'<style[\s\S]*?</style>', '', content, flags=re.IGNORECASE)
    m = re.search(r'<body[^>]*>([\s\S]*?)</body>', content, flags=re.IGNORECASE)
    return m.group(1) if m else content


def clean_line(line):
    text = re.sub(r'\s+', ' ', line).strip()
    if not text:
        return ''
    low = text.lower()
    if low in ('cover page', 'title page'):
        return ''
    if low.startswith('@page'):
        return ''
    if '{' in text and '}' in text and ':' in text:
        return ''
    return text


class EpubAssetManager:
    def __init__(self, zf, seed_asset_dir):
        self.zf = zf
        self.seed_asset_dir = seed_asset_dir
        self.seed_asset_dir.mkdir(parents=True, exist_ok=True)
        self.cache = {}

    def resolve_image(self, chapter_zip_path, raw_src):
        src = (raw_src or '').strip()
        if not src:
            return ''
        if src.startswith('data:') or src.startswith('http://') or src.startswith('https://'):
            return src

        src = src.split('#', 1)[0].split('?', 1)[0]
        if not src:
            return ''

        chapter_dir = Path(chapter_zip_path).parent
        zip_img_path = resolve_zip_path(self.zf, chapter_dir, src)
        if not zip_img_path:
            return ''

        if zip_img_path in self.cache:
            return f'seedasset://{self.cache[zip_img_path]}'

        ext = Path(zip_img_path).suffix.lower() or '.bin'
        digest = hashlib.sha1(zip_img_path.encode('utf-8')).hexdigest()[:16]
        filename = f'{digest}{ext}'
        local_path = self.seed_asset_dir / filename
        if not local_path.exists():
            local_path.write_bytes(self.zf.read(zip_img_path))

        self.cache[zip_img_path] = filename
        return f'seedasset://{filename}'


class ChapterHtmlBuilder(HTMLParser):
    def __init__(self, image_resolver):
        super().__init__(convert_charrefs=True)
        self.image_resolver = image_resolver
        self.text_parts = []
        self.blocks = []
        self.image_count = 0

    def flush_text(self):
        raw = ''.join(self.text_parts)
        self.text_parts = []
        line = clean_line(raw)
        if line:
            self.blocks.append({'type': 'p', 'text': line})

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        attrs_map = {k.lower(): (v or '') for k, v in attrs}
        if tag in BLOCK_TAGS:
            self.flush_text()
            return
        if tag == 'br':
            self.text_parts.append('\n')
            return
        if tag == 'img':
            self.flush_text()
            src = self.image_resolver(attrs_map.get('src', ''))
            if src:
                alt = attrs_map.get('alt', '').strip()
                self.blocks.append({'type': 'img', 'src': src, 'alt': alt})
                self.image_count += 1

    def handle_endtag(self, tag):
        if tag.lower() in BLOCK_TAGS:
            self.flush_text()

    def handle_data(self, data):
        self.text_parts.append(data)

    def finish(self):
        self.flush_text()

    def to_content_html(self):
        if not self.blocks:
            return '<p>(No content)</p>'

        out = []
        for block in self.blocks:
            if block['type'] == 'p':
                out.append(f"<p>{html.escape(block['text'])}</p>")
            elif block['type'] == 'img':
                src = html.escape(block['src'], quote=True)
                alt = html.escape(block.get('alt', ''), quote=True)
                out.append(f'<p><img src="{src}" alt="{alt}" /></p>')
        return ''.join(out)

    def text_char_count(self):
        return sum(len(block['text']) for block in self.blocks if block['type'] == 'p')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--epub', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--book-id', default='qiutujianshen')
    parser.add_argument('--seed-cover-out', default='cloudfunctions/library/seed/qiutu-cover.jpg')
    parser.add_argument('--seed-assets-dir', default='cloudfunctions/library/seed/assets')
    args = parser.parse_args()

    epub_path = Path(args.epub)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    seed_assets_root = Path(args.seed_assets_dir)
    seed_assets_dir = seed_assets_root / args.book_id
    if seed_assets_dir.exists():
        shutil.rmtree(seed_assets_dir)
    seed_assets_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(epub_path, 'r') as zf:
        opf_path = find_rootfile(zf)
        title, manifest, spine, cover_href = parse_opf(zf, opf_path)
        opf_base = Path(opf_path).parent

        cover_path_local = None
        if cover_href:
            cover_path = resolve_zip_path(zf, opf_base, cover_href)
            if cover_path:
                cover_raw = zf.read(cover_path)
                suffix = Path(cover_path).suffix.lower() or '.jpg'
                cover_filename = f'{args.book_id}-cover{suffix}'
                cover_path_local = out_dir / cover_filename
                cover_path_local.write_bytes(cover_raw)

        asset_manager = EpubAssetManager(zf, seed_assets_dir)

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

            chapter_zip_path = resolve_zip_path(zf, opf_base, href)
            if not chapter_zip_path:
                continue

            raw = zf.read(chapter_zip_path)
            content = decode_chapter_content(raw)
            body_html = extract_body_html(content)

            builder = ChapterHtmlBuilder(lambda src, p=chapter_zip_path: asset_manager.resolve_image(p, src))
            builder.feed(body_html)
            builder.finish()

            text_count = builder.text_char_count()
            image_count = builder.image_count
            if text_count < 80 and image_count == 0:
                continue

            chapter_no += 1
            fallback = f'Chapter {chapter_no}'
            chapter_title = extract_title_from_content(content, fallback)

            chapters.append({
                'bookId': args.book_id,
                'chapterNo': chapter_no,
                'chapterTitle': chapter_title,
                'contentHtml': builder.to_content_html(),
                'wordCount': text_count,
                'imageCount': image_count,
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
    print(f'assets: {len(asset_manager.cache)}')
    print(f'cover: {cover_path_local.name if cover_path_local else "not found"}')
    if copied_seed_cover:
        print(f'seed_cover: {copied_seed_cover}')
    print(f'seed_assets_dir: {seed_assets_dir}')
    print(f'output: {out_dir}')


if __name__ == '__main__':
    main()