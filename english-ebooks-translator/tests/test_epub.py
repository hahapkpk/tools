import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from ebook_translator.core import inspect_epub


def temporary_directory():
    scratch = Path(__file__).resolve().parents[1] / '.test-tmp'
    scratch.mkdir(exist_ok=True)
    return tempfile.TemporaryDirectory(dir=scratch)


def book(path):
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/content.opf"/></rootfiles></container>')
        z.writestr('EPUB/content.opf', '<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>News</dc:title><dc:language>en</dc:language></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>')
        z.writestr('EPUB/a.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>News</title><style>body { color:red }</style></head><body><h1>Headline</h1><p>Hello <em>world</em> today.</p><figure><img src="pic.png"/><figcaption>A picture</figcaption></figure><pre>Keep code</pre><a href="a.xhtml#x">Contents</a></body></html>')
        z.writestr('EPUB/toc.ncx', '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint><navLabel><text>News</text></navLabel><content src="a.xhtml"/></navPoint></navMap></ncx>')
        z.writestr('EPUB/pic.png', b'\x89PNG\r\n\x1a\nimage')
        z.writestr('EPUB/other.css', 'body {color:red}')


class EpubTests(unittest.TestCase):
    def setUp(self):
        self.tmp = temporary_directory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.src = self.root / 'in.epub'
        book(self.src)

    def test_compressed_member_limit_is_checked_before_decompression(self):
        from unittest.mock import patch
        from ebook_translator.core import TranslationError
        with zipfile.ZipFile(self.src, 'a') as z:
            z.writestr('private-payload.bin', b'SECRET' * 1024,
                       compress_type=zipfile.ZIP_DEFLATED)
        with patch('ebook_translator.core.MAX_MEMBER_BYTES', 1024, create=True), \
                patch.object(zipfile.ZipFile, 'open') as opened:
            with self.assertRaisesRegex(TranslationError, '^EPUB member exceeds expanded byte limit$'):
                inspect_epub(self.src)
            opened.assert_not_called()

    def test_member_count_limit_is_checked_before_decompression(self):
        from unittest.mock import patch
        from ebook_translator.core import TranslationError
        with patch('ebook_translator.core.MAX_MEMBERS', 6, create=True), \
                patch.object(zipfile.ZipFile, 'open') as opened:
            with self.assertRaisesRegex(TranslationError, '^EPUB exceeds ZIP member count limit$'):
                inspect_epub(self.src)
            opened.assert_not_called()

    def test_total_limit_is_checked_before_decompression(self):
        from unittest.mock import patch
        from ebook_translator.core import TranslationError
        with zipfile.ZipFile(self.src) as z:
            total = sum(i.file_size for i in z.infolist())
            self.assertLess(max(i.file_size for i in z.infolist()), total - 1)
        with patch('ebook_translator.core.MAX_TOTAL_BYTES', total - 1, create=True), \
                patch.object(zipfile.ZipFile, 'open') as opened:
            with self.assertRaisesRegex(TranslationError, '^EPUB exceeds total expanded byte limit$'):
                inspect_epub(self.src)
            opened.assert_not_called()

    def test_member_reads_are_bounded_and_valid_bytes_are_unchanged(self):
        from unittest.mock import patch
        from ebook_translator.core import Book
        with zipfile.ZipFile(self.src, 'a') as z:
            z.writestr('EPUB/padding.bin', b'x' * 150_000,
                       compress_type=zipfile.ZIP_DEFLATED)
        before = self.src.read_bytes()
        with zipfile.ZipFile(self.src) as z:
            expected = {i.filename: z.read(i) for i in z.infolist()}
        original_read = zipfile.ZipExtFile.read
        calls = []
        def bounded_read(stream, size=-1):
            self.assertGreater(size, 0, 'Unbounded decompression read')
            self.assertLessEqual(size, 64 * 1024)
            calls.append(size)
            return original_read(stream, size)
        with patch.object(zipfile.ZipExtFile, 'read', bounded_read):
            loaded = Book(self.src)
        self.assertGreater(len(calls), len(expected))
        self.assertEqual(loaded.members, expected)
        self.assertEqual(self.src.read_bytes(), before)

    def test_streaming_member_limit_does_not_trust_declared_size(self):
        import io
        from unittest.mock import patch
        from ebook_translator.core import TranslationError
        with zipfile.ZipFile(self.src, 'a') as z:
            z.writestr('private-payload.bin', b'')
        original_open = zipfile.ZipFile.open
        payload = io.BytesIO(b'SECRET' * 1024)
        reads = []
        def read_member(archive, info, *args, **kwargs):
            if info.filename == 'private-payload.bin':
                return payload
            return original_open(archive, info, *args, **kwargs)
        original_read = payload.read
        def tracked_read(size=-1):
            reads.append(size)
            return original_read(size)
        with patch('ebook_translator.core.MAX_MEMBER_BYTES', 1024), \
                patch.object(zipfile.ZipFile, 'open', read_member), \
                patch.object(payload, 'read', tracked_read):
            with self.assertRaisesRegex(TranslationError, '^EPUB member exceeds expanded byte limit$'):
                inspect_epub(self.src)
        self.assertEqual(reads, [1025])
        self.assertTrue(payload.closed)

    def test_streaming_total_limit_counts_actual_bytes_across_members(self):
        import io
        from unittest.mock import patch
        from ebook_translator.core import TranslationError
        with zipfile.ZipFile(self.src, 'a') as z:
            z.writestr('private-payload.bin', b'')
        with zipfile.ZipFile(self.src) as z:
            declared = sum(i.file_size for i in z.infolist())
        original_open = zipfile.ZipFile.open
        payload = io.BytesIO(b'SECRET' * 128)
        reads = []
        def read_member(archive, info, *args, **kwargs):
            if info.filename == 'private-payload.bin':
                return payload
            return original_open(archive, info, *args, **kwargs)
        original_read = payload.read
        def tracked_read(size=-1):
            reads.append(size)
            return original_read(size)
        with patch('ebook_translator.core.MAX_TOTAL_BYTES', declared + 32), \
                patch.object(zipfile.ZipFile, 'open', read_member), \
                patch.object(payload, 'read', tracked_read):
            with self.assertRaisesRegex(TranslationError, '^EPUB exceeds total expanded byte limit$'):
                inspect_epub(self.src)
        self.assertEqual(reads, [33])
        self.assertTrue(payload.closed)

    def test_structural_roundtrip_preserves_members_markup_and_images(self):
        from ebook_translator.core import translate_epub
        class FakeTranslator:
            # Deterministic translator is unit-test-only; never a CLI mode.
            def translate(self, units):
                return {u.id: '译文' + u.text for u in units}
        out = self.root / 'zh.epub'
        result = translate_epub(self.src, out, translator=FakeTranslator())
        self.assertEqual(result['translated_units'], 8)
        self.assertTrue(result['complete'])
        with zipfile.ZipFile(self.src) as a, zipfile.ZipFile(out) as b:
            self.assertEqual(a.namelist(), b.namelist())
            self.assertEqual(b.infolist()[0].filename, 'mimetype')
            self.assertEqual(b.infolist()[0].compress_type, zipfile.ZIP_STORED)
            for name in a.namelist():
                if name not in {'EPUB/a.xhtml', 'EPUB/toc.ncx', 'EPUB/content.opf'}:
                    self.assertEqual(a.read(name), b.read(name))
            x = b.read('EPUB/a.xhtml').decode()
            self.assertIn('<em>译文world</em> 译文today.', x)
            self.assertIn('<pre>Keep code</pre>', x)
            self.assertIn('<img src="pic.png"/>', x)
            self.assertIn('<a href="a.xhtml#x">译文Contents</a>', x)
            self.assertIn('xml:lang="zh-Hans"', x)
            self.assertIn('<dc:language>zh-Hans</dc:language>', b.read('EPUB/content.opf').decode())
            self.assertIn('<text>译文News</text>', b.read('EPUB/toc.ncx').decode())
            for name in b.namelist():
                if name.endswith(('.xml', '.opf', '.xhtml', '.ncx')):
                    ET.fromstring(b.read(name))

    def test_inline_text_nodes_share_paragraph_identity_and_batch_boundary(self):
        from ebook_translator.core import Book, batches
        units = Book(self.src).units
        selected = [u for u in units if u.text in {'Hello', 'world', 'today.'}]
        self.assertEqual(len(selected), 3)
        self.assertEqual(len({u.group for u in selected}), 1)
        groups = list(batches(selected, 1))
        self.assertEqual(len(groups), 1, 'Never split one inline paragraph across API batches')
        self.assertEqual(len({u.context for u in selected}), 3, 'Cache keys distinguish slots')

    def test_sample_does_not_cache_a_partial_inline_paragraph(self):
        from ebook_translator.core import translate_epub
        class Fake:
            def translate(self, units):
                return {u.id: '中文' for u in units}
        result = translate_epub(self.src, self.root/'out.sample.epub', translator=Fake(), max_units=3)
        self.assertEqual(result['translated_units'], 2, 'A sample must stop before a partly selected paragraph')

    def test_safety_guards_refuse_before_network_and_keep_old_output(self):
        from ebook_translator.core import translate_epub, TranslationError
        class Never:
            def translate(self, units):
                raise AssertionError('Must not call translator')
        out = self.root / 'zh.epub'
        out.write_bytes(b'previous output')
        with self.assertRaisesRegex(TranslationError, 'max-chars'):
            translate_epub(self.src, out, translator=Never(), max_chars=1)
        with self.assertRaisesRegex(TranslationError, 'sample'):
            translate_epub(self.src, out, translator=Never(), max_units=1)
        self.assertEqual(out.read_bytes(), b'previous output')
        class Broken:
            def translate(self, units):
                return {units[0].id: ''}
        with self.assertRaises(TranslationError):
            translate_epub(self.src, out, translator=Broken())
        self.assertEqual(out.read_bytes(), b'previous output')
        self.assertFalse(list(self.root.glob('.epub-*')))

    def test_cache_commits_batches_and_resumes_after_failure(self):
        from ebook_translator.core import translate_epub, TranslationError
        class Fake:
            signature = 'unit-test-model-v1'
            def __init__(self, fail=False):
                self.calls = 0
                self.fail = fail
            def translate(self, units):
                self.calls += 1
                if self.fail and self.calls == 2:
                    raise TranslationError('unit test interruption')
                return {u.id: '译文' + u.text for u in units}
        cache = self.root / 'cache.sqlite'
        out = self.root / 'zh.epub'
        with self.assertRaisesRegex(TranslationError, 'interruption'):
            translate_epub(self.src, out, translator=Fake(True), cache=cache, batch_chars=10)
        self.assertFalse(out.exists())
        resumed = Fake()
        result = translate_epub(self.src, out, translator=resumed, cache=cache, batch_chars=10)
        self.assertGreater(result['cache_hits'], 0)
        self.assertGreater(resumed.calls, 0)
        cached = Fake()
        result = translate_epub(self.src, out, translator=cached, cache=cache)
        self.assertEqual(cached.calls, 0)
        self.assertEqual(result['cache_hits'], 8)
        changed = Fake()
        changed.signature = 'unit-test-model-v2'
        result = translate_epub(self.src, out, translator=changed, cache=cache)
        self.assertEqual(result['cache_hits'], 0)
        self.assertGreater(changed.calls, 0)

    def test_long_text_nodes_are_chunked_without_changing_markup(self):
        from ebook_translator.core import Book, translate_epub
        long = ('A long sentence about economics. ' * 400).strip()
        with zipfile.ZipFile(self.src, 'a') as z:
            z.writestr('EPUB/long.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>  ' + long + '  </p></body></html>')
        class Fake:
            def __init__(self):
                self.lengths = []
            def translate(self, units):
                self.lengths.extend(len(u.text) for u in units)
                return {u.id: '译' for u in units}
        fake = Fake()
        out = self.root / 'zh.epub'
        translate_epub(self.src, out, translator=fake)
        self.assertLessEqual(max(fake.lengths), 2000)
        with zipfile.ZipFile(out) as z:
            root = ET.fromstring(z.read('EPUB/long.xhtml'))
            text = ''.join(root.itertext())
            self.assertNotIn('sentence', text)
            self.assertTrue(text.startswith('  译'))
            self.assertTrue(text.endswith('译  '))

    def test_sample_output_is_labeled_in_epub_not_just_json(self):
        from ebook_translator.core import translate_epub
        class Fake:
            def translate(self, units):
                return {u.id: '中文' for u in units}
        out = self.root / 'preview.sample.epub'
        result = translate_epub(self.src, out, translator=Fake(), max_units=1)
        self.assertFalse(result['complete'])
        self.assertTrue(result['sample'])
        with zipfile.ZipFile(out) as z:
            root = ET.fromstring(z.read('EPUB/content.opf'))
            title = root.find('.//{http://purl.org/dc/elements/1.1/}title').text
            self.assertTrue(title.startswith('[SAMPLE / 部分翻译] '))
            self.assertIn('<h1>Headline</h1>', z.read('EPUB/a.xhtml').decode())

    def test_invalid_xml_text_never_enters_persistent_cache(self):
        import sqlite3
        from ebook_translator.core import translate_epub, TranslationError
        class Bad:
            def translate(self, units):
                return {u.id: '\x00' for u in units}
        cache = self.root / 'cache.sqlite'
        out = self.root / 'zh.epub'
        with self.assertRaises(TranslationError):
            translate_epub(self.src, out, translator=Bad(), cache=cache)
        from contextlib import closing
        with closing(sqlite3.connect(cache)) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM translations').fetchone()[0], 0)
        self.assertFalse(out.exists())

    def test_input_output_cache_paths_must_be_distinct(self):
        from ebook_translator.core import translate_epub, TranslationError
        class Never:
            def translate(self, units):
                raise AssertionError('No request permitted')
        out = self.root / 'out.epub'
        for destination, cache in [(self.src, None), (out, self.src), (out, out)]:
            with self.subTest(destination=destination, cache=cache), self.assertRaises(TranslationError):
                translate_epub(self.src, destination, translator=Never(), cache=cache)

    def test_atomic_publish_failure_preserves_existing_output(self):
        from unittest.mock import patch
        from ebook_translator.core import translate_epub
        class Fake:
            def translate(self, units):
                return {u.id: '中文 & <text>' for u in units}
        out = self.root / 'zh.epub'
        out.write_bytes(b'old output')
        with patch('ebook_translator.core.os.replace', side_effect=OSError('unit test locked file')):
            with self.assertRaises(OSError):
                translate_epub(self.src, out, translator=Fake())
        self.assertEqual(out.read_bytes(), b'old output')
        self.assertEqual(list(self.root.glob('.epub-*')), [])
        translate_epub(self.src, out, translator=Fake(), metadata_title=True)
        with zipfile.ZipFile(out) as z:
            opf = ET.fromstring(z.read('EPUB/content.opf'))
            self.assertEqual(opf.find('.//{http://purl.org/dc/elements/1.1/}title').text, '中文 & <text>')
            self.assertIn('中文 &amp; &lt;text&gt;', z.read('EPUB/a.xhtml').decode())

    def test_bad_cache_is_closed_on_initialization_failure(self):
        import gc
        import sqlite3
        import warnings
        from ebook_translator.core import Cache
        path = self.root / 'broken.sqlite'
        path.write_bytes(b'not a sqlite database')
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter('always', ResourceWarning)
            with self.assertRaises(sqlite3.Error):
                Cache(path, 'unit-test')
            gc.collect()
        self.assertEqual([w for w in caught if issubclass(w.category, ResourceWarning)], [])
        path.unlink()

    def test_inspection_is_read_only_and_counts_units(self):
        before = self.src.read_bytes()
        result = inspect_epub(self.src)
        self.assertEqual(result['xhtml_files'], 1)
        self.assertEqual(result['image_files'], 1)
        self.assertEqual(result['units'], 8)
        self.assertGreater(result['characters'], 20)
        self.assertEqual(self.src.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
