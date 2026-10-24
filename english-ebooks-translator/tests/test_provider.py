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
            self.assertIn('A headline about economics', body['messages'][1]['content'])
            self.assertEqual(client.usage['total_tokens'], 120)


if __name__ == '__main__':
    unittest.main()
