"""Local HTTP fixtures only: no real API calls or credentials."""
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ebook_translator.core import Unit, TranslationError


class FixtureServer:
    def __init__(self, replies):
        self.replies = list(replies)
        self.requests = []
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                size = int(self.headers.get('Content-Length', 0))
                owner.requests.append((self.path, json.loads(self.rfile.read(size)) if size else None))
                status, reply, *extra = owner.replies.pop(0)
                self.send_response(status)
                for key, value in (extra[0] if extra else {}).items():
                    self.send_header(key, value)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(reply).encode())
            do_GET = do_POST
            def log_message(self, *args):
                pass
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    @property
    def url(self):
        return 'http://127.0.0.1:%s/v1' % self.server.server_port

    def __exit__(self, *args):
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()


def response(content, finish='stop'):
    return {'choices': [{'finish_reason': finish, 'message': {'role': 'assistant', 'content': content}}],
            'usage': {'prompt_tokens': 100, 'completion_tokens': 20, 'total_tokens': 120}}


class ProviderTests(unittest.TestCase):
    def test_inline_slots_are_translated_as_one_paragraph_without_context_leak(self):
        from ebook_translator.provider import ChatTranslator
        units = [Unit('4', 'a.xhtml', 1, 'Curfews followed the', 'Do not translate this unrelated context'),
                 Unit('5', 'a.xhtml', 3, 'worst riots', 'Do not translate this unrelated context'),
                 Unit('6', 'a.xhtml', 5, 'in years. Two thousand were arrested.', 'Do not translate this unrelated context')]
        for unit in units:
            unit.group = 'paragraph-1'
        good = response(json.dumps({'4': '宵禁实施，此前发生了⟦S1⟧多年来最严重的骚乱⟦S2⟧。两千人被捕。'}))
        with FixtureServer([(200, good)]) as server:
            c = ChatTranslator(api_key='unit-test-placeholder', base_url=server.url, retries=0)
            result = c.translate(units)
            self.assertEqual(result, {'4': '宵禁实施，此前发生了', '5': '多年来最严重的骚乱', '6': '。两千人被捕。'})
            payload = json.loads(server.requests[0][1]['messages'][1]['content'])
            self.assertEqual(len(payload), 1)
            self.assertIn('⟦S1⟧', payload[0]['text'])
            self.assertNotIn('unrelated context', server.requests[0][1]['messages'][1]['content'])

    def test_missing_or_duplicated_slot_markers_are_refused(self):
        from ebook_translator.provider import ChatTranslator
        units = [Unit('4', 'a.xhtml', 1, 'Hello', ''), Unit('5', 'a.xhtml', 3, 'world', '')]
        for unit in units:
            unit.group = 'p'
        for value in ('你好世界', '你好⟦S1⟧世界⟦S1⟧重复', '你好⟦S2⟧世界', '⟦S1⟧世界'):
            with self.subTest(value=value), FixtureServer([(200, response(json.dumps({'4': value})))]) as server:
                c = ChatTranslator(api_key='unit-test-placeholder', base_url=server.url, retries=0)
                with self.assertRaises(TranslationError):
                    c.translate(units)

    def test_retries_invalid_responses_strictly_and_sanitizes_errors(self):
        from ebook_translator.provider import ChatTranslator
        units = [Unit('4', 'a.xhtml', 0, 'Hello', 'reference')]
        invalid = [response('{"4":""}'), response('{"4":"你好","extra":"bad"}'),
                   response('{"4":"x","4":"y"}'), response('```json\n{"4":"x"}\n```'),
                   response('{"4":"x"}', 'length'), {}, {'choices': 'bad'}, response('{"wrong":"x"}')]
        for reply in invalid:
            with self.subTest(reply=reply), FixtureServer([(200, reply), (200, response('{"4":"你好"}'))]) as server:
                client = ChatTranslator(api_key='unit-test-placeholder', base_url=server.url, retries=1, backoff=0)
                self.assertEqual(client.translate(units), {'4': '你好'})
                self.assertEqual(len(server.requests), 2)
        with FixtureServer([(401, {'error': 'unit-test-placeholder payload Hello'})]) as server:
            client = ChatTranslator(api_key='unit-test-placeholder', base_url=server.url, retries=2, backoff=0)
            with self.assertRaises(TranslationError) as caught:
                client.translate(units)
            self.assertNotIn('placeholder', str(caught.exception))
            self.assertNotIn('Hello', str(caught.exception))
            self.assertEqual(len(server.requests), 1)
        with FixtureServer([(200, response('bad')), (200, response('bad'))]) as server:
            client = ChatTranslator(api_key='unit-test-placeholder', base_url=server.url, retries=1, backoff=0)
            with self.assertRaisesRegex(TranslationError, 'invalid response'):
                client.translate(units)

    def test_endpoint_security_and_provider_specific_thinking(self):
        from ebook_translator.provider import ChatTranslator
        for url in ['http://remote.example/v1', 'https://user:pass@example.com/v1',
                    'https://example.com/v1?token=x', 'https://example.com/v1#fragment']:
            with self.subTest(url=url), self.assertRaises(TranslationError):
                ChatTranslator(api_key='unit-test-placeholder', base_url=url)
        official = ChatTranslator(api_key='unit-test-placeholder')
        self.assertEqual(official.thinking, {'type': 'disabled'})
        generic = ChatTranslator(api_key='unit-test-placeholder', base_url='https://example.com/v1', model='custom')
        self.assertIsNone(generic.thinking)
        units = [Unit('4', 'a.xhtml', 0, 'Hello', 'reference')]
        with FixtureServer([(200, response('{"4":"你好"}'))]) as server:
            c = ChatTranslator(api_key='unit-test-placeholder', base_url=server.url, thinking='disabled')
            c.translate(units)
            self.assertEqual(server.requests[0][1]['thinking'], {'type': 'disabled'})

    def test_redirects_never_forward_credentials_or_book_payload(self):
        from ebook_translator.provider import ChatTranslator
        units = [Unit('4', 'a.xhtml', 0, 'Hello', 'reference')]
        with FixtureServer([(200, response('{"4":"你好"}'))]) as target:
            with FixtureServer([(302, {}, {'Location': target.url})]) as origin:
                c = ChatTranslator(api_key='unit-test-placeholder', base_url=origin.url, retries=0)
                with self.assertRaisesRegex(TranslationError, '302'):
                    c.translate(units)
            self.assertEqual(target.requests, [])

    def test_real_urllib_request_json_ids_usage_and_context(self):
        from ebook_translator.provider import ChatTranslator
        units = [Unit('4', 'a.xhtml', 0, 'Hello', 'A headline about economics')]
        with FixtureServer([(200, response('{"4":"你好"}'))]) as server:
            client = ChatTranslator(api_key='unit-test-placeholder', base_url=server.url)
            self.assertEqual(client.translate(units), {'4': '你好'})
            path, body = server.requests[0]
            self.assertEqual(path, '/v1/chat/completions')
            self.assertEqual(body['model'], 'deepseek-v4-flash')
            self.assertEqual(body['response_format'], {'type': 'json_object'})
            self.assertFalse(body['stream'])
            self.assertIn('简体中文', body['messages'][0]['content'])
            self.assertIn('glossary', body['messages'][0]['content'])
            self.assertNotIn('A headline about economics', body['messages'][1]['content'])
            self.assertEqual(client.usage['total_tokens'], 120)


if __name__ == '__main__':
    unittest.main()
