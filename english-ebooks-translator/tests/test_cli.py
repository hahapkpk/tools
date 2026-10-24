import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from test_epub import book, temporary_directory
from test_provider import FixtureServer, response


class CliTests(unittest.TestCase):
    def test_inspect_and_translate_are_real_json_cli_commands(self):
        with temporary_directory() as td:
            root = Path(td)
            src = root / 'in.epub'
            book(src)
            env = dict(os.environ)
            env.pop('DEEPSEEK_API_KEY', None)
            inspected = subprocess.run([sys.executable, '-m', 'ebook_translator', 'inspect', '--input', str(src)],
                                       capture_output=True, text=True, encoding='utf-8', env=env)
            self.assertEqual(inspected.returncode, 0, inspected.stderr)
            self.assertEqual(json.loads(inspected.stdout)['units'], 8)
            cmd = [sys.executable, '-m', 'ebook_translator', 'translate', '--input', str(src),
                   '--output', str(root / 'out.epub'), '--cache', str(root / 'cache.sqlite')]
            missing = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', env=env)
            self.assertNotEqual(missing.returncode, 0)
            self.assertIn('environment', json.loads(missing.stderr)['error'])
            mapping = json.dumps({'0': '新闻', '1': '标题', '2': '你好⟦S1⟧世界⟦S2⟧。', '5': '图片', '6': '目录', '7': '新闻'})
            env['UNIT_TEST_ONLY_KEY'] = 'unit-test-placeholder'
            with FixtureServer([(200, response(mapping))]) as server:
                result = subprocess.run(cmd + ['--api-key-env', 'UNIT_TEST_ONLY_KEY', '--base-url', server.url,
                                              '--input-price-per-million', '1', '--output-price-per-million', '2'],
                                        capture_output=True, text=True, encoding='utf-8', env=env)
                self.assertEqual(result.returncode, 0, result.stderr)
                report = json.loads(result.stdout)
                self.assertTrue(report['complete'])
                self.assertEqual(report['usage']['total_tokens'], 120)
                self.assertAlmostEqual(report['estimated_cost'], 0.00014)
                self.assertTrue((root / 'out.epub').exists())
            self.assertNotIn('placeholder', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
