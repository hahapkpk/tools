"""Console-only, process-scoped secret setup. Never writes credentials."""
import getpass
import os
from pathlib import Path
import subprocess
import sys
import warnings
from .weekly import translate_command


def configure_run(env, prompt=input, secret=getpass.getpass, runner=subprocess.run):
    source = Path(prompt('Input EPUB path: ').strip().strip('"')).expanduser().resolve()
    if not source.is_file():
        print('Input file not found.')
        return 1
    output_text = prompt('Output EPUB path (blank: beside input with .zh.epub): ').strip().strip('"')
    output = Path(output_text).expanduser().resolve() if output_text else source.with_suffix('.zh.epub')
    if output == source or output.exists():
        print('Refusing to overwrite an existing file.')
        return 1
    model = prompt('Model (blank: deepseek-v4-flash): ').strip() or 'deepseek-v4-flash'
    if prompt('Paid full translation; cost unknown. Type YES to continue: ') != 'YES':
        print('Cancelled; no API request made.')
        return 0
    child_env = dict(env)
    child_env['DEEPSEEK_MODEL'] = model
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        key = secret('DEEPSEEK_API_KEY (hidden, this process only): ')
    if not key:
        print('API key is required.')
        return 1
    child_env['DEEPSEEK_API_KEY'] = key
    cache_root = Path(env.get('LOCALAPPDATA') or Path.home()/'.local/share')/'EnglishEbooksTranslator'
    command = translate_command(source, output, cache_root/'translation.sqlite3', child_env)
    try:
        result = runner(command, env=dict(child_env), stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    finally:
        child_env.pop('DEEPSEEK_API_KEY', None)
        key = None
    print('Translation completed.' if result.returncode == 0 else 'Translation failed; sensitive output suppressed.')
    return result.returncode


if __name__ == '__main__':
    try:
        if not sys.stdin.isatty():
            raise RuntimeError('A real console is required for hidden secret input.')
        raise SystemExit(configure_run(os.environ))
    except (Exception, KeyboardInterrupt):
        print('Setup cancelled or failed; no credentials saved.')
        raise SystemExit(1)
