"""Run with python -m ebook_translator inspect|translate."""
import argparse
import json
import math
import os
from pathlib import Path
import sqlite3
import sys
from .core import TranslationError, inspect_epub, translate_epub
from .provider import ChatTranslator, DEFAULT_BASE_URL, DEFAULT_MODEL, strict_json


class Parser(argparse.ArgumentParser):
    def error(self, message):
        # Do not echo command-line values; they may contain sensitive mistakes.
        self.exit(2, json.dumps({'error': 'Invalid arguments; run --help'}, ensure_ascii=True) + '\n')


def parser():
    p = Parser(description='Translate EPUB XML text nodes into simplified Chinese, preserving markup and assets.')
    commands = p.add_subparsers(dest='command', required=True)
    inspect = commands.add_parser('inspect', help='Read-only XML/ZIP inspection; no API key or network needed')
    inspect.add_argument('--input', required=True)
    inspect.add_argument('--metadata-title', action='store_true')
    tr = commands.add_parser('translate', help='Translate a complete EPUB; unfinished full runs never replace output')
    tr.add_argument('--input', required=True)
    tr.add_argument('--output', required=True)
    tr.add_argument('--cache', required=True, help='Private SQLite cache: contains original and translated book text')
    tr.add_argument('--max-units', type=int, help='SAMPLE ONLY; output filename must contain sample; JSON reports partial status')
    tr.add_argument('--max-chars', type=int, default=500_000, help='Maximum selected source characters, including cached text (default 500000); NOT a dollar/token cap')
    tr.add_argument('--model', default=DEFAULT_MODEL)
    tr.add_argument('--base-url', default=DEFAULT_BASE_URL)
    tr.add_argument('--api-key-env', default='DEEPSEEK_API_KEY', help='Environment variable NAME, never the secret itself')
    tr.add_argument('--batch-chars', type=int, default=6000)
    tr.add_argument('--timeout', type=float, default=120)
    tr.add_argument('--retries', type=int, default=2, help='Additional attempts per batch; retries can incur additional charges')
    tr.add_argument('--thinking', choices=['auto', 'disabled', 'omit'], default='auto', help='auto disables thinking only for official DeepSeek models; omit for other providers')
    tr.add_argument('--metadata-title', action='store_true', help='Also translate OPF dc:title (off by default)')
    tr.add_argument('--glossary', help='UTF-8 JSON object mapping source phrases to preferred Chinese translations')
    tr.add_argument('--input-price-per-million', type=float, help='Optional user-supplied input-token rate, in a consistent currency')
    tr.add_argument('--output-price-per-million', type=float, help='Optional user-supplied output-token rate; cost estimate ignores cache discounts')
    return p


def emit(data, stream):
    print(json.dumps(data, ensure_ascii=True, sort_keys=True), file=stream)


def main(argv=None):
    args = parser().parse_args(argv)
    client = None
    try:
        if args.command == 'inspect':
            emit(inspect_epub(args.input, args.metadata_title), sys.stdout)
            return 0
        rates = [args.input_price_per_million, args.output_price_per_million]
        if any(v is not None and (not math.isfinite(v) or v < 0) for v in rates):
            raise TranslationError('Token price rates must be nonnegative finite values')
        glossary = None
        if args.glossary:
            glossary = strict_json(Path(args.glossary).read_text(encoding='utf-8'))
            if not isinstance(glossary, dict) or any(not isinstance(k, str) or not k.strip() or not isinstance(v, str) or not v.strip() for k,v in glossary.items()):
                raise TranslationError('Glossary must be a JSON object of nonempty string pairs')
        client = ChatTranslator(api_key=os.environ.get(args.api_key_env, ''), model=args.model,
                                base_url=args.base_url, timeout=args.timeout, retries=args.retries,
                                thinking=args.thinking, glossary=glossary)
        result = translate_epub(args.input, args.output, translator=client, cache=args.cache,
                                max_units=args.max_units, max_chars=args.max_chars,
                                batch_chars=args.batch_chars, metadata_title=args.metadata_title)
        estimated_cost = None
        if all(v is not None for v in rates) and 'prompt_tokens' in client.usage and 'completion_tokens' in client.usage:
            estimated_cost = (client.usage['prompt_tokens'] * rates[0] + client.usage['completion_tokens'] * rates[1]) / 1_000_000
        result.update(model=client.model, usage=client.usage, requests=client.requests,
                      estimated_cost=estimated_cost, cost_basis='user_supplied_rates_no_cache_discount' if estimated_cost is not None else 'not_available')
        emit(result, sys.stdout)
        return 0
    except TranslationError as error:
        emit({'error': str(error), 'usage': client.usage if client else {}, 'requests': client.requests if client else 0}, sys.stderr)
        return 1
    except (OSError, ValueError, sqlite3.Error):
        emit({'error': 'Local file, cache, or configuration error; no output published', 'usage': client.usage if client else {}}, sys.stderr)
        return 1
    except KeyboardInterrupt:
        emit({'error': 'Interrupted; completed cache batches retained; retry the same command'}, sys.stderr)
        return 130


if __name__ == '__main__':
    raise SystemExit(main())
