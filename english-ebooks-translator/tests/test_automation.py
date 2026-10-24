import unittest
from automation import weekly as w


class DiscoveryTests(unittest.TestCase):
    def test_skip_old_issue_directories_before_api_requests(self):
        self.assertFalse(w.eligible_directory('01_economist/te_2025.10.24', '2026.10.24'))
        self.assertFalse(w.eligible_directory('01_economist/te_2026.10.17', '2026.10.24'))
        self.assertTrue(w.eligible_directory('01_economist/te_2026.10.24', '2026.10.24'))
        self.assertTrue(w.eligible_directory('01_economist/te_2026.10.31', '2026.10.24'))
        self.assertTrue(w.eligible_directory('01_economist/2026', '2026.10.24'))

    def test_dates_and_discovery(self):
        entries = [
            {'path': '01_economist/2026/TheEconomist.2026.10.24.epub', 'type': 'blob', 'sha': 'a'*40, 'size': 10},
            {'path': '01_economist/2026/TheEconomist.2026.10.17.epub', 'type': 'blob', 'sha': 'b'*40, 'size': 10},
            {'path': '01_economist/2026/TheEconomist.2026.02.30.epub', 'type': 'blob', 'sha': 'c'*40, 'size': 10},
            {'path': 'other/TheEconomist.2026.10.31.epub', 'type': 'blob', 'sha': 'd'*40, 'size': 10},
        ]
        issues = w.discover(entries, '2026.10.24')
        self.assertEqual([i.date for i in issues], ['2026.10.24'])
        self.assertEqual(w.discover(entries, '2026.10.25'), [])
        with self.assertRaises(ValueError):
            w.discover(entries, '2026.02.30')


class IdentityTests(unittest.TestCase):
    def test_identity_private_guard_and_pending_selection(self):
        a = w.Issue('2026.10.24', '01_economist/a.epub', 'a'*40, 10)
        b = w.Issue('2026.10.31', '01_economist/b.epub', 'b'*40, 10)
        self.assertEqual(w.release_tag(a), 'economist-2026.10.24-' + 'a'*40)
        w.require_private({'private': True, 'full_name': 'me/english-reading-zh'}, 'me/english-reading-zh')
        for repo in ({'private': False}, {'private': 'true'}, {'private': True, 'full_name': 'other/repo'}):
            with self.assertRaises(w.SafeError):
                w.require_private(repo, 'me/english-reading-zh')
        done = {'tag_name': w.release_tag(a), 'draft': False, 'manifest': {'status': 'complete', 'source_sha': a.sha}, 'verified': True}
        self.assertEqual(w.choose_issue([b, a], [done]), b)
        self.assertIsNone(w.choose_issue([a], [done]))
        self.assertEqual(w.choose_issue([a], [dict(done, draft=True)]), a)
        self.assertEqual(w.choose_issue([a], [dict(done, verified=False)]), a)
        revised = w.Issue(a.date, a.path, 'c'*40, 10)
        self.assertEqual(w.choose_issue([revised], [done]), revised)


class BlobTests(unittest.TestCase):
    def test_blob_verification_and_translation_command(self):
        import base64
        import hashlib
        data = b'epub bytes'
        sha = hashlib.sha1(b'blob 10\0' + data).hexdigest()
        issue = w.Issue('2026.10.24', '01_economist/a.epub', sha, len(data))
        blob = {'sha': sha, 'size': len(data), 'encoding': 'base64', 'content': base64.b64encode(data).decode()}
        self.assertEqual(w.verified_blob(issue, blob, 100), data)
        for broken in (dict(blob, sha='a'*40), dict(blob, content='eA=='), dict(blob, size=1000)):
            with self.assertRaises(w.SafeError):
                w.verified_blob(issue, broken, 100)
        with self.assertRaises(w.SafeError):
            w.verified_blob(issue, blob, 1)
        cmd = w.translate_command('in.epub', 'out.epub', 'cache.db', {})
        self.assertIn('deepseek-v4-flash', cmd)
        self.assertIn('600000', cmd)
        self.assertIn('DEEPSEEK_API_KEY', cmd)
        self.assertNotIn('--max-units', cmd)
        custom = w.translate_command('i', 'o', 'c', {'DEEPSEEK_MODEL': 'custom', 'MAX_SOURCE_CHARS': '12'})
        self.assertIn('custom', custom)
        self.assertIn('12', custom)


class RuntimeTests(unittest.TestCase):
    def exercise(self, private=True, fail_upload=False, recover=False, two_issues=False, corrupt=False, sample=False, revision=''):
        import base64, hashlib, json, tempfile
        from pathlib import Path
        source = b'input epub'
        sha = hashlib.sha1(b'blob 10\0' + source).hexdigest()
        tag = 'economist-2026.10.24-' + sha
        releases, assets, calls = [], {}, []
        translations = []
        env = {'GITHUB_REPOSITORY': 'me/english-reading-zh', 'GITHUB_TOKEN': 'not-real', 'DEEPSEEK_API_KEY': 'not-real'}
        if sample:
            env['TRANSLATION_MODE'] = 'sample'
            tag = 'sample-' + tag
        if revision:
            env['TRANSLATION_REVISION'] = revision
            tag += '-' + revision
        def api(path, public=False):
            calls.append(('api', path, public))
            if path == '/repos/me/english-reading-zh':
                return {'private': private, 'full_name': 'me/english-reading-zh'}
            if '/contents/01_economist' in path:
                return [{'type': 'dir', 'name': '2026', 'path': '01_economist/2026', 'sha': 'f'*40}]
            if '/git/trees/' in path:
                return {'truncated': False, 'tree': ([{'path': 'TheEconomist.2026.10.31.epub', 'type': 'blob', 'sha': 'b'*40, 'size': 10}] if two_issues else []) + [{'path': 'TheEconomist.2026.10.24.epub', 'type': 'blob', 'sha': sha, 'size': 10}]}
            if '/git/blobs/' in path:
                return {'sha': sha, 'size': 10, 'encoding': 'base64', 'content': base64.b64encode(source).decode()}
            if '/releases/tags/' in path:
                return next(r for r in releases if r['tag_name'] == path.rsplit('/', 1)[-1])
            if '/releases?' in path:
                return releases if 'page=1&' in path else []
            raise AssertionError(path)
        def command(args):
            calls.append(('command', args))
            if '-m' in args:
                if sample:
                    self.assertIn('--max-units', args)
                    self.assertEqual(args[args.index('--max-units') + 1], '100')
                    self.assertIn('sample', args[args.index('--output') + 1])
                translations.append(1)
                Path(args[args.index('--output')+1]).write_bytes(b'translated epub')
                return
            action, selected = args[2], args[3]
            if action == 'create':
                releases.append({'tag_name': selected, 'draft': True, 'assets': []})
            elif action == 'upload':
                if fail_upload:
                    raise w.SafeError('Command failed.')
                for name in args[4:args.index('--clobber')]:
                    p = Path(name)
                    assets[p.name] = p.read_bytes()
                releases[0]['assets'] = [{'name': name, 'size': len(data)} for name, data in assets.items()]
            elif action == 'download':
                name = args[args.index('--pattern')+1]
                Path(args[args.index('--output')+1]).write_bytes(b'corrupted' if corrupt else assets[name])
            elif action == 'edit':
                releases[0]['draft'] = False
            else:
                raise AssertionError(args)
        with tempfile.TemporaryDirectory() as folder:
            env['CACHE_PATH'] = str(Path(folder)/'cache.sqlite3')
            if not private:
                with self.assertRaises(w.SafeError):
                    w.run(env, api, command)
                self.assertEqual(len(calls), 1)
                return
            if fail_upload or corrupt:
                with self.assertRaises(w.SafeError):
                    w.run(env, api, command)
                self.assertTrue(releases[0]['draft'])
                if fail_upload:
                    fail_upload = False
                    self.assertEqual(w.run(env, api, command), 'published')
                    self.assertEqual(len(releases), 1)
                return
            self.assertEqual(w.run(env, api, command), 'published')
            self.assertFalse(releases[0]['draft'])
            self.assertTrue(any(c[0] == 'api' and c[1].endswith('/releases/tags/' + tag) for c in calls))
            manifest = json.loads(assets['manifest.json'])
            self.assertEqual(manifest['source_sha'], sha)
            self.assertEqual(manifest['status'], 'complete')
            if two_issues:
                self.assertEqual(len(translations), 1)
                self.assertEqual(len(releases), 1)
                self.assertEqual(releases[0]['tag_name'], tag)
                return
            if recover:
                releases[0]['draft'] = True
                self.assertEqual(w.run(env, api, command), 'published')
            self.assertEqual(w.run(env, api, command), 'up-to-date')
            self.assertEqual(len(translations), 1)
            self.assertEqual(releases[0]['tag_name'], tag)
            self.assertNotIn('not-real', json.dumps(assets['manifest.json'].decode()))

    def test_only_earliest_of_two_issues_is_processed(self):
        self.exercise(two_issues=True)

    def test_sample_uses_separate_release_and_partial_cli(self):
        self.exercise(sample=True)

    def test_new_translation_revision_has_distinct_release_identity(self):
        self.exercise(sample=True, revision='paragraph-v2')

    def test_corrupted_upload_never_publishes(self):
        self.exercise(corrupt=True)

    def test_publish_and_skip_completed_revision(self):
        self.exercise()

    def test_private_guard_prevents_source_download(self):
        self.exercise(private=False)

    def test_failed_upload_never_publishes(self):
        self.exercise(fail_upload=True)

    def test_complete_draft_recovers_without_translation(self):
        self.exercise(recover=True)


class BoundaryTests(unittest.TestCase):
    def test_api_and_subprocess_errors_are_sanitized(self):
        from unittest.mock import patch
        import io, urllib.error
        with patch('urllib.request.urlopen', side_effect=urllib.error.HTTPError('secret-url', 401, 'secret-body', {}, None)):
            with self.assertRaises(w.SafeError) as caught:
                w.GitHub('secret-key')('/repos/me/private')
            self.assertNotIn('secret', str(caught.exception))
        class Response(io.BytesIO):
            pass
        with patch('urllib.request.urlopen', return_value=Response(b'{"private":true}')) as request:
            self.assertTrue(w.GitHub('secret-key')('/repos/me/private')['private'])
            self.assertEqual(request.call_args.args[0].get_header('Authorization'), 'Bearer secret-key')
        with patch('urllib.request.urlopen', return_value=Response(b'[]')) as request:
            w.GitHub('secret-key')('/repos/public/repo', public=True)
            self.assertIsNone(request.call_args.args[0].get_header('Authorization'))
        import subprocess
        with patch('subprocess.run', side_effect=subprocess.CalledProcessError(1, ['secret'], stderr='secret')):
            with self.assertRaises(w.SafeError) as caught:
                w.quiet_command(['test'])
            self.assertNotIn('secret', str(caught.exception))
        with patch('subprocess.run') as called:
            w.quiet_command(['test'])
            self.assertEqual(called.call_args.kwargs['stdout'], subprocess.DEVNULL)

    def test_translation_failure_reports_only_allowlisted_category(self):
        from unittest.mock import patch
        import subprocess, json
        stderr = json.dumps({'error': 'Translation API failed after 3 attempts (invalid response)', 'usage': {'total_tokens': 123}, 'private': 'must-not-print'})
        error = subprocess.CalledProcessError(1, ['python'], stderr=stderr.encode())
        with patch('subprocess.run', side_effect=error):
            with self.assertRaisesRegex(w.SafeError, 'invalid-response') as caught:
                w.quiet_command(['python', '-m', 'ebook_translator', 'translate'])
            self.assertNotIn('must-not-print', str(caught.exception))

    def test_main_summary_contains_only_fixed_metadata(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as folder:
            summary = Path(folder)/'summary'
            env = {'GITHUB_STEP_SUMMARY': str(summary), 'DEEPSEEK_API_KEY': 'never-print'}
            with patch.object(w, 'run', return_value='up-to-date'):
                self.assertEqual(w.main(env), 0)
            with patch.object(w, 'run', side_effect=RuntimeError('never-print article')):
                self.assertEqual(w.main(env), 1)
            text = summary.read_text()
            self.assertIn('up-to-date', text)
            self.assertNotIn('never-print', text)
            self.assertNotIn('article', text)

    def test_local_setup_uses_process_environment_only(self):
        from automation import local_setup
        from unittest.mock import Mock
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder)/'source.epub'
            source.write_bytes(b'x')
            answers = iter([str(source), str(Path(folder)/'out.epub'), '', 'YES'])
            runner = Mock(return_value=Mock(returncode=0))
            env = {'PATH': 'test-path'}
            from contextlib import redirect_stdout
            import io
            with redirect_stdout(io.StringIO()) as output:
                self.assertEqual(local_setup.configure_run(env, lambda _: next(answers), lambda _: 'private-key', runner), 0)
            self.assertNotIn('private-key', output.getvalue())
            args, kwargs = runner.call_args
            self.assertIn('translate', args[0])
            self.assertEqual(kwargs['env']['DEEPSEEK_API_KEY'], 'private-key')
            self.assertNotIn('private-key', repr(args))
            self.assertNotIn('DEEPSEEK_API_KEY', env)
            self.assertFalse(any(p.suffix in ('.json', '.env') for p in Path(folder).iterdir()))


if __name__ == '__main__':
    unittest.main()
