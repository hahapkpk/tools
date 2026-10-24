"""Private-repository weekly EPUB automation (stdlib only)."""
from dataclasses import dataclass
from datetime import datetime
import re
import base64
import hashlib
import sys
import json
import os
from pathlib import Path
import tempfile


MAX_EPUB_BYTES = 20 * 1024 * 1024
SOURCE = 'hehonghui/awesome-english-ebooks'


def verified_blob(issue, blob, cap=MAX_EPUB_BYTES):
    if not (0 < issue.size <= cap and blob.get('size') == issue.size
            and blob.get('sha') == issue.sha and blob.get('encoding') == 'base64'):
        raise SafeError('Source blob metadata or size is invalid.')
    try:
        data = base64.b64decode(''.join(blob['content'].split()), validate=True)
    except (ValueError, KeyError, TypeError):
        raise SafeError('Source blob encoding is invalid.') from None
    digest = hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()
    if len(data) != issue.size or digest != issue.sha:
        raise SafeError('Source blob integrity verification failed.')
    return data


def translate_command(source, output, cache, env):
    cap = int(env.get('MAX_SOURCE_CHARS') or '600000')
    if cap <= 0:
        raise SafeError('MAX_SOURCE_CHARS must be positive.')
    args = [sys.executable, '-m', 'ebook_translator', 'translate', '--input', str(source),
            '--output', str(output), '--cache', str(cache), '--model',
            env.get('DEEPSEEK_MODEL') or 'deepseek-v4-flash', '--base-url',
            env.get('DEEPSEEK_BASE_URL') or 'https://api.deepseek.com/v1',
            '--max-chars', str(cap), '--api-key-env', 'DEEPSEEK_API_KEY']
    if env.get('TRANSLATION_MODE') == 'sample':
        args.extend(['--max-units', '100'])
    return args


@dataclass(frozen=True)
class Issue:
    date: str
    path: str
    sha: str
    size: int


class SafeError(RuntimeError):
    """Only fixed, non-sensitive messages may leave automation."""


def require_private(repo, expected):
    if repo.get('private') is not True or repo.get('full_name') != expected:
        raise SafeError('Target must be the authenticated current private repository.')


def release_tag(issue):
    return f'economist-{issue.date}-{issue.sha}'


def choose_issue(issues, releases):
    for issue in sorted(issues, key=lambda i: (i.date, i.path, i.sha)):
        if not any(r.get('tag_name') == release_tag(issue) and r.get('draft') is False
                   and r.get('manifest', {}).get('status') == 'complete'
                   and r.get('manifest', {}).get('source_sha') == issue.sha
                   and r.get('verified') is True for r in releases):
            return issue
    return None


def discover(entries, start='2026.10.24'):
    cutoff = datetime.strptime(start, '%Y.%m.%d').date()
    issues = []
    for entry in entries:
        path = entry.get('path', '')
        match = re.search(r'(?<!\d)(\d{4}\.\d{2}\.\d{2})(?!\d)', path.rsplit('/', 1)[-1])
        if not (path.startswith('01_economist/') and path.lower().endswith('.epub')
                and entry.get('type') == 'blob' and match
                and re.fullmatch('[0-9a-f]{40}', entry.get('sha', ''))):
            continue
        try:
            date = datetime.strptime(match[1], '%Y.%m.%d').date()
        except ValueError:
            continue
        if date >= cutoff:
            issues.append(Issue(match[1], path, entry['sha'], entry.get('size', 0)))
    return sorted(issues, key=lambda i: (i.date, i.path, i.sha))


def eligible_directory(path, start):
    """Avoid one API request per historical issue; keep unknown layouts discoverable."""
    match = re.fullmatch(r'te_(\d{4}\.\d{2}\.\d{2})', path.rsplit('/', 1)[-1])
    if match is None:
        return True
    try:
        return datetime.strptime(match[1], '%Y.%m.%d') >= datetime.strptime(start, '%Y.%m.%d')
    except ValueError:
        return False


def run(env, api, command):
    """One issue per invocation; injectable API/command boundaries for offline tests."""
    mode = env.get('TRANSLATION_MODE') or 'full'
    if mode not in {'sample', 'full'}:
        raise SafeError('Invalid translation mode.')
    revision = env.get('TRANSLATION_REVISION') or ''
    if revision and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', revision):
        raise SafeError('Invalid translation revision.')
    output_name = 'translated.sample.zh.epub' if mode == 'sample' else 'translated.zh.epub'
    repo = env.get('GITHUB_REPOSITORY', '')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise SafeError('GITHUB_REPOSITORY is required.')
    require_private(api(f'/repos/{repo}'), repo)
    if not env.get('GITHUB_TOKEN') or not env.get('DEEPSEEK_API_KEY'):
        raise SafeError('Required runtime secrets are missing.')
    root = api(f'/repos/{SOURCE}/contents/01_economist?ref=master', public=True)
    entries = []
    for child in root:
        if child.get('type') == 'file':
            entries.append(dict(child, type='blob'))
        elif child.get('type') == 'dir' and eligible_directory(child['path'], env.get('START_ISSUE') or '2026.10.24'):
            tree = api(f'/repos/{SOURCE}/git/trees/{child["sha"]}?recursive=1', public=True)
            if tree.get('truncated'):
                raise SafeError('Upstream discovery tree is truncated; refusing partial discovery.')
            entries.extend(dict(e, path=child['path'] + '/' + e['path']) for e in tree['tree'])
    issues = discover(entries, env.get('START_ISSUE') or '2026.10.24')
    releases = []
    page = 1
    while True:
        batch = api(f'/repos/{repo}/releases?page={page}&per_page=100')
        releases.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    cache = Path(env.get('CACHE_PATH') or '.cache/translation.sqlite3').resolve()
    cache.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='weekly-epub-') as folder:
        work = Path(folder)
        for issue in issues:
            tag = ('sample-' if mode == 'sample' else '') + release_tag(issue) + ('-' + revision if revision else '')
            release = next((r for r in releases if r.get('tag_name') == tag), None)
            verified = False
            if release:
                names = {a['name']: a for a in release.get('assets', [])}
                if 'manifest.json' in names and names['manifest.json']['size'] <= 65536:
                    command(['gh', 'release', 'download', tag, '--pattern', 'manifest.json',
                             '--output', str(work/'remote-manifest.json'), '--clobber', '--repo', repo])
                    try:
                        manifest = json.loads((work/'remote-manifest.json').read_text(encoding='utf-8'))
                    except (ValueError, OSError):
                        manifest = {}
                    if (manifest.get('status') == 'complete' and manifest.get('source_sha') == issue.sha
                            and manifest.get('source_path') == issue.path
                            and manifest.get('output_name') == output_name
                            and isinstance(manifest.get('output_size'), int)
                            and 0 < manifest['output_size'] <= 100 * 1024 * 1024
                            and names.get(output_name, {}).get('size') == manifest['output_size']):
                        command(['gh', 'release', 'download', tag, '--pattern', output_name,
                                 '--output', str(work/'remote.epub'), '--clobber', '--repo', repo])
                        data = (work/'remote.epub').read_bytes()
                        verified = (len(data) == manifest['output_size'] and
                                    hashlib.sha256(data).hexdigest() == manifest.get('output_sha256'))
                if verified and release.get('draft') is False:
                    continue
                if not verified and release.get('draft') is False:
                    raise SafeError('Existing published release failed integrity checks; manual review required.')
            # A complete draft can be finalized without another paid translation.
            if not verified:
                if not 0 < issue.size <= MAX_EPUB_BYTES:
                    raise SafeError('Source EPUB exceeds the download size cap.')
                blob = api(f'/repos/{SOURCE}/git/blobs/{issue.sha}', public=True)
                (work/'source.epub').write_bytes(verified_blob(issue, blob))
                require_private(api(f'/repos/{repo}'), repo)
                command(translate_command(work/'source.epub', work/output_name, cache, env))
                output = work/output_name
                if not output.is_file() or not 0 < output.stat().st_size <= 100 * 1024 * 1024:
                    raise SafeError('Translator did not produce a valid-sized complete output.')
                manifest = {'schema': 1, 'status': 'complete', 'source_repo': SOURCE,
                            'source_path': issue.path, 'source_sha': issue.sha, 'issue': issue.date,
                            'output_name': output.name, 'output_size': output.stat().st_size,
                            'output_sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                            'model': env.get('DEEPSEEK_MODEL') or 'deepseek-v4-flash', 'mode': mode,
                            'translation_revision': revision or 'legacy-node-v1'}
                (work/'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
                require_private(api(f'/repos/{repo}'), repo)
                if release is None:
                    command(['gh', 'release', 'create', tag, '--draft', '--title',
                             f'{"SAMPLE " if mode == "sample" else ""}Economist {issue.date} ZH', '--notes', 'Private translated edition; see manifest.json. Samples contain untranslated sections.',
                             '--repo', repo])
                command(['gh', 'release', 'upload', tag, str(output), str(work/'manifest.json'),
                         '--clobber', '--repo', repo])
                # Verify actual bytes after upload, not merely CLI success or reported sizes.
                for name in (output_name, 'manifest.json'):
                    target = work/('verified-' + name)
                    command(['gh', 'release', 'download', tag, '--pattern', name,
                             '--output', str(target), '--clobber', '--repo', repo])
                    if target.read_bytes() != (work/name).read_bytes():
                        raise SafeError('Uploaded release asset byte verification failed.')
            require_private(api(f'/repos/{repo}'), repo)
            command(['gh', 'release', 'edit', tag, '--draft=false', '--latest=false', '--repo', repo])
            final = api(f'/repos/{repo}/releases/tags/{tag}')
            if final.get('tag_name') != tag or final.get('draft') is not False:
                raise SafeError('Release publication read-back failed.')
            return 'published'
    return 'up-to-date'


class GitHub:
    def __init__(self, token):
        self.token = token

    def __call__(self, path, public=False):
        import urllib.request
        import urllib.error
        if not path.startswith('/repos/') or '\n' in path or '\r' in path:
            raise SafeError('Invalid GitHub API path.')
        headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'private-epub-translator',
                   'X-GitHub-Api-Version': '2022-11-28'}
        if not public:
            headers['Authorization'] = 'Bearer ' + self.token
        request = urllib.request.Request('https://api.github.com' + path, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                raw = response.read(32 * 1024 * 1024 + 1)
            if len(raw) > 32 * 1024 * 1024:
                raise SafeError('GitHub API response exceeds safety cap.')
            return json.loads(raw)
        except urllib.error.HTTPError as error:
            status = error.code
            error.close()
            raise SafeError(f'GitHub API request failed (HTTP {status}).') from None
        except (urllib.error.URLError, OSError, ValueError):
            raise SafeError('GitHub API response unavailable or invalid.') from None


def quiet_command(args):
    import subprocess
    try:
        subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                       stdin=subprocess.DEVNULL, timeout=6 * 60 * 60)
    except subprocess.CalledProcessError as error:
        if args[1:3] == ['-m', 'ebook_translator']:
            try:
                message = json.loads(error.stderr or b'{}').get('error', '')
                categories = {'inline-marker-mismatch': 'inline-marker-mismatch',
                              'empty-inline-segment': 'empty-inline-segment',
                              'response-id-mismatch': 'response-id-mismatch',
                              'invalid response': 'invalid-response',
                              'network or timeout error': 'network-or-timeout'}
                category = next((v for k, v in categories.items() if k in message), None)
                if category:
                    raise SafeError('Translation stopped: ' + category) from None
            except (ValueError, TypeError, AttributeError):
                pass
        raise SafeError('Command failed; sensitive process output suppressed.') from None
    except (OSError, subprocess.SubprocessError):
        raise SafeError('Command failed; sensitive process output suppressed.') from None


def main(env=None):
    env = os.environ if env is None else env
    status, code = 'failed (details suppressed)', 1
    try:
        status = run(env, GitHub(env.get('GITHUB_TOKEN', '')), quiet_command)
        code = 0
    except SafeError as error:
        status = str(error)
        print(status, file=sys.stderr)
    except Exception:
        # Never emit exception messages, request bodies, commands or model responses.
        pass
    if env.get('GITHUB_STEP_SUMMARY'):
        with open(env['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as stream:
            stream.write(f'### Private EPUB automation\nStatus: {status}\nMaximum issues per run: 1\n')
    return code


if __name__ == '__main__':
    raise SystemExit(main())
