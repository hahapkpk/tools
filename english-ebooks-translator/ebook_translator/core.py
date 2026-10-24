"""EPUB reader: validate XML and edit lexical text slots, not markup."""
import hashlib
import html
import posixpath
import re
import zipfile
import json
import sqlite3
import os
import tempfile
from xml.sax.saxutils import escape
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET


class TranslationError(Exception):
    """Safe, user-facing error without upstream response bodies."""


TOKEN = re.compile(r'<!--.*?-->|<!\[CDATA\[.*?\]\]>|<\?.*?\?>|<!DOCTYPE[^>]*>|<(?:[^>\"\']|\"[^\"]*\"|\'[^\']*\')*>|[^<]+', re.S)
SKIP = {'script', 'style', 'code', 'pre', 'kbd', 'samp', 'math', 'svg'}
XML_EXTENSIONS = ('.xml', '.opf', '.ncx', '.xhtml', '.html', '.svg')
BLOCK_TAGS = {'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'figcaption', 'caption', 'td', 'th', 'title', 'dt', 'dd', 'blockquote'}
MAX_MEMBER_BYTES = 32 * 1024 * 1024
MAX_MEMBERS = 10_000
MAX_TOTAL_BYTES = 256 * 1024 * 1024


def local(tag):
    return tag.rsplit('}', 1)[-1].split(':')[-1]


def parse_xml(data):
    if b'<!ENTITY' in data or re.search(br'<!DOCTYPE[^>]*(?:SYSTEM|PUBLIC)', data, re.I):
        raise TranslationError('External DTDs and entity declarations are not supported')
    try:
        return ET.fromstring(data)
    except ET.ParseError:
        raise TranslationError('Invalid XML in EPUB') from None


@dataclass
class Unit:
    id: str
    member: str
    index: int
    text: str
    context: str
    start: int = 0
    end: int | None = None
    group: str = ''


def text_chunks(text, limit=2000):
    start = 0
    while start < len(text):
        end = min(start + limit, len(text))
        if end < len(text):
            space = text.rfind(' ', start + limit // 2, end)
            if space != -1:
                end = space + 1
        fragment = text[start:end]
        left = start + len(fragment) - len(fragment.lstrip())
        right = end - (len(fragment) - len(fragment.rstrip()))
        if left < right:
            yield left, right, text[left:right]
        start = end


class Book:
    def __init__(self, path, metadata_title=False):
        try:
            with zipfile.ZipFile(path) as z:
                self.infos = z.infolist()
                if len(self.infos) > MAX_MEMBERS:
                    raise TranslationError('EPUB exceeds ZIP member count limit')
                names = [i.filename for i in self.infos]
                if len(set(names)) != len(names):
                    raise TranslationError('Duplicate ZIP members')
                if any(i.flag_bits & 1 for i in self.infos):
                    raise TranslationError('Encrypted EPUB is not supported')
                if any(i.file_size > MAX_MEMBER_BYTES for i in self.infos):
                    raise TranslationError('EPUB member exceeds expanded byte limit')
                if sum(i.file_size for i in self.infos) > MAX_TOTAL_BYTES:
                    raise TranslationError('EPUB exceeds total expanded byte limit')
                self.members = {}
                total = 0
                for info in self.infos:
                    data = bytearray()
                    with z.open(info) as member:
                        while True:
                            # One extra byte detects overflow without an unbounded read.
                            chunk = member.read(min(64 * 1024,
                                                    MAX_MEMBER_BYTES - len(data) + 1,
                                                    MAX_TOTAL_BYTES - total + 1))
                            if not chunk:
                                break
                            if len(data) + len(chunk) > MAX_MEMBER_BYTES:
                                raise TranslationError('EPUB member exceeds expanded byte limit')
                            total += len(chunk)
                            if total > MAX_TOTAL_BYTES:
                                raise TranslationError('EPUB exceeds total expanded byte limit')
                            data.extend(chunk)
                    self.members[info.filename] = bytes(data)
                self.comment = z.comment
        except (OSError, zipfile.BadZipFile):
            raise TranslationError('Cannot read EPUB ZIP') from None
        if self.members.get('mimetype') != b'application/epub+zip':
            raise TranslationError('Missing or invalid EPUB mimetype')
        self.roots = {n: parse_xml(d) for n, d in self.members.items() if n.lower().endswith(XML_EXTENSIONS)}
        container = self.roots.get('META-INF/container.xml')
        if container is None:
            raise TranslationError('Missing container.xml')
        rootfiles = [e.attrib.get('full-path') for e in container.iter() if local(e.tag) == 'rootfile']
        if not rootfiles or rootfiles[0] not in self.roots:
            raise TranslationError('Missing OPF package')
        self.opf = rootfiles[0]
        self.tokens = {}
        self.units = []
        for name, root in self.roots.items():
            kind = 'xhtml' if name.lower().endswith(('.html', '.xhtml')) else 'ncx' if name.lower().endswith('.ncx') else 'opf' if name == self.opf else None
            if kind is None:
                continue
            try:
                text = self.members[name].decode('utf-8')
            except UnicodeDecodeError:
                raise TranslationError('Translation requires UTF-8 XML') from None
            tokens = TOKEN.findall(text)
            if ''.join(tokens) != text:
                raise TranslationError('Unsupported XML tokenization')
            self.tokens[name] = tokens
            stack = []
            starts = []
            for index, token in enumerate(tokens):
                if token.startswith(('<?', '<!', '\ufeff')) and not token.startswith('<![CDATA['):
                    continue
                if token.startswith('</'):
                    stack.pop()
                    starts.pop()
                elif token.startswith('<') and not token.startswith('<![CDATA['):
                    if not token.endswith('/>'):
                        stack.append(local(re.match(r'<([^\s/>]+)', token).group(1)))
                        starts.append(index)
                else:
                    value = token[9:-3] if token.startswith('<![CDATA[') else html.unescape(token)
                    eligible = kind == 'xhtml' and not (set(stack) & SKIP)
                    eligible |= kind == 'ncx' and bool(stack) and stack[-1] == 'text'
                    eligible |= kind == 'opf' and metadata_title and bool(stack) and stack[-1] == 'title'
                    if value.strip() and eligible:
                        parent = next((starts[j] for j in range(len(stack)-1, -1, -1) if stack[j] in BLOCK_TAGS), starts[-1] if starts else index)
                        group = f'{name}:{parent}'
                        for start, end, fragment in text_chunks(value):
                            self.units.append(Unit(str(len(self.units)), name, index, fragment, '', start, end, group))
        grouped = {}
        for unit in self.units:
            grouped.setdefault(unit.group, []).append(unit)
        for units in grouped.values():
            digest = hashlib.sha256(json.dumps([u.text for u in units], ensure_ascii=False).encode('utf-8')).hexdigest()
            for ordinal, unit in enumerate(units):
                unit.context = f'paragraph-v2:{digest}:slot:{ordinal}'

    def summary(self):
        return {'members': len(self.members), 'xhtml_files': sum(n.lower().endswith(('.html', '.xhtml')) for n in self.members),
                'image_files': sum(n.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp')) for n in self.members),
                'units': len(self.units), 'characters': sum(len(u.text) for u in self.units), 'opf': self.opf,
                'image_hashes': {n: hashlib.sha256(d).hexdigest() for n, d in self.members.items() if n.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'))}}


def inspect_epub(path, metadata_title=False):
    return Book(path, metadata_title).summary()


def validate_mapping(result, units):
    if not isinstance(result, dict) or set(result) != {u.id for u in units}:
        raise TranslationError('Translation IDs must match the requested IDs exactly')
    if any(not isinstance(v, str) or not v.strip() for v in result.values()):
        raise TranslationError('Translation contains empty or invalid text')
    if any(re.search('[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]', v) for v in result.values()):
        raise TranslationError('Translation contains invalid XML characters')
    return result


def language_tag(token):
    token = re.sub(r'\s+(?:xml:lang|lang)\s*=\s*([\"\']).*?\1', '', token)
    return token[:-1] + ' lang="zh-Hans" xml:lang="zh-Hans">'


def write_epub(book, output, translations, sample=False):
    members = dict(book.members)
    tokens = {n: list(t) for n, t in book.tokens.items()}
    slots = {}
    for u in book.units:
        if u.id in translations:
            slots.setdefault((u.member, u.index), []).append(u)
    for (name, index), units in slots.items():
        original = tokens[name][index]
        raw = original[9:-3] if original.startswith('<![CDATA[') else html.unescape(original)
        for u in reversed(units):
            raw = raw[:u.start] + translations[u.id] + raw[u.end:]
        tokens[name][index] = escape(raw)
    for name, parts in tokens.items():
        if name.lower().endswith(('.html', '.xhtml')):
            for i, t in enumerate(parts):
                if re.match(r'<(?:\w+:)?html(?:\s|>)', t):
                    parts[i] = language_tag(t)
                    break
        if name == book.opf:
            if sample:
                for i, t in enumerate(parts):
                    if re.match(r'<(?:\w+:)?title(?:\s|>)', t):
                        parts[i] += '[SAMPLE / 部分翻译] '
                        break
            inside_language = False
            for i, t in enumerate(parts):
                if re.match(r'<(?:\w+:)?language(?:\s|>)', t):
                    inside_language = True
                elif t.startswith('</'):
                    inside_language = False
                elif inside_language and not t.startswith('<'):
                    parts[i] = 'zh-Hans'
        members[name] = ''.join(parts).encode('utf-8')
    # Validation happens before replacing an existing destination.
    for name, data in members.items():
        if name.lower().endswith(XML_EXTENSIONS):
            parse_xml(data)
    for name in book.summary()['image_hashes']:
        if members[name] != book.members[name]:
            raise TranslationError('Image preservation validation failed')
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.epub-', suffix='.tmp', dir=output.parent)
    os.close(fd)
    try:
        with zipfile.ZipFile(temp, 'w') as z:
            ordered = sorted(book.infos, key=lambda i: i.filename != 'mimetype')
            for info in ordered:
                import copy
                info = copy.copy(info)
                if info.filename == 'mimetype':
                    info.compress_type = zipfile.ZIP_STORED
                    info.extra = b''
                z.writestr(info, members[info.filename])
            z.comment = book.comment
        with zipfile.ZipFile(temp) as z:
            if z.testzip() is not None or set(z.namelist()) != set(book.members):
                raise TranslationError('Output ZIP validation failed')
            for name, expected in members.items():
                if z.read(name) != expected:
                    raise TranslationError('Output member verification failed')
        os.replace(temp, output)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


class Cache:
    def __init__(self, path, signature):
        if path is not None:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path) if path is not None else ':memory:')
        try:
            self.db.execute('CREATE TABLE IF NOT EXISTS translations (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        except sqlite3.Error:
            self.db.close()
            raise
        self.signature = signature

    def key(self, unit):
        data = json.dumps(['epub-text-v1', self.signature, unit.text, unit.context], ensure_ascii=False)
        return hashlib.sha256(data.encode('utf-8')).hexdigest()

    def get(self, unit):
        row = self.db.execute('SELECT value FROM translations WHERE key=?', (self.key(unit),)).fetchone()
        return row[0] if row and row[0].strip() else None

    def put(self, units, result):
        with self.db:
            self.db.executemany('INSERT OR REPLACE INTO translations VALUES (?,?)', [(self.key(u), result[u.id]) for u in units])

    def close(self):
        self.db.close()


def batches(units, limit):
    batch, size = [], 0
    for u in units:
        if batch and (size + len(u.text) > limit or len(batch) >= 40) and (not u.group or u.group != batch[-1].group):
            yield batch
            batch, size = [], 0
        batch.append(u)
        size += len(u.text)
    if batch:
        yield batch


def translate_epub(input_path, output_path, *, translator, metadata_title=False,
                   max_chars=500_000, max_units=None, cache=None, batch_chars=6000):
    paths = [Path(input_path).resolve(), Path(output_path).resolve()]
    if cache is not None:
        paths.append(Path(cache).resolve())
    if len(set(paths)) != len(paths):
        raise TranslationError('Input, output, and cache must be different paths')
    book = Book(input_path, metadata_title)
    if max_units is not None and (max_units < 1 or 'sample' not in Path(output_path).stem.lower()):
        raise TranslationError('Partial runs require a positive --max-units and an output filename containing sample')
    selected = book.units if max_units is None else book.units[:max_units]
    if max_units is not None and selected and len(selected) < len(book.units):
        cut_group = book.units[len(selected)].group
        while selected and selected[-1].group == cut_group:
            selected.pop()
        if not selected:
            raise TranslationError('Sample limit is too small to include a complete paragraph')
    if max_chars < 1 or sum(len(u.text) for u in selected) > max_chars:
        raise TranslationError('Source text exceeds --max-chars; inspect first and explicitly raise the limit')
    if batch_chars < 1:
        raise TranslationError('batch-chars must be positive')
    database = Cache(cache, getattr(translator, 'signature', translator.__class__.__qualname__))
    translations, pending = {}, []
    try:
        for u in selected:
            value = database.get(u)
            if value is None:
                pending.append(u)
            else:
                translations[u.id] = value
        cache_hits = len(translations)
        for batch in batches(pending, batch_chars):
            result = validate_mapping(translator.translate(batch), batch)
            database.put(batch, result)
            translations.update(result)
    finally:
        database.close()
    if max_units is None and len(translations) != len(book.units):
        raise TranslationError('Unfinished full translation refused')
    write_epub(book, output_path, translations, sample=max_units is not None)
    return {**book.summary(), 'translated_units': len(translations), 'complete': len(translations) == len(book.units),
            'cache_hits': cache_hits, 'sample': max_units is not None, 'status': 'sample_partial_translation' if max_units is not None else 'complete'}
