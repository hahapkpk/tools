# DingTalk Notion Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Python sync project that pushes DingTalk activity records into a Notion detail database and summary page.

**Architecture:** The project lives in `dingtalk-notion-sync/` with small modules for config, DingTalk API access, record normalization, Notion API access, Notion block/property generation, and orchestration. Tests mock network behavior and verify all mapping and dry-run behavior without real credentials.

**Tech Stack:** Python 3.12, `requests`, `python-dotenv`, `pytest`, GitHub Actions.

---

### File Structure

- Create: `dingtalk-notion-sync/pyproject.toml` - package metadata and pytest config.
- Create: `dingtalk-notion-sync/requirements.txt` - runtime and test dependencies.
- Create: `dingtalk-notion-sync/.env.example` - placeholder-only configuration.
- Create: `dingtalk-notion-sync/README.md` - setup, Notion schema, secrets, run commands.
- Create: `dingtalk-notion-sync/sync.py` - CLI entrypoint.
- Create: `dingtalk-notion-sync/src/dingtalk_notion_sync/config.py` - environment and CLI config.
- Create: `dingtalk-notion-sync/src/dingtalk_notion_sync/http.py` - HTTP JSON helper with safe errors.
- Create: `dingtalk-notion-sync/src/dingtalk_notion_sync/dingtalk.py` - token and paginated record fetching.
- Create: `dingtalk-notion-sync/src/dingtalk_notion_sync/records.py` - DingTalk field normalization and filtering.
- Create: `dingtalk-notion-sync/src/dingtalk_notion_sync/notion_blocks.py` - Notion block/property builders.
- Create: `dingtalk-notion-sync/src/dingtalk_notion_sync/notion_client.py` - Notion query, create, update, replace blocks.
- Create: `dingtalk-notion-sync/src/dingtalk_notion_sync/syncer.py` - orchestration and stats.
- Create: `dingtalk-notion-sync/tests/test_records.py` - normalization and filtering tests.
- Create: `dingtalk-notion-sync/tests/test_notion_blocks.py` - property and summary block tests.
- Create: `dingtalk-notion-sync/tests/test_syncer.py` - dry-run and upsert orchestration tests.
- Create: `.github/workflows/dingtalk-notion-sync.yml` - scheduled/manual workflow.

### Task 1: Tests for Record Normalization

**Files:**
- Create: `dingtalk-notion-sync/tests/test_records.py`
- Create minimal package placeholder: `dingtalk-notion-sync/src/dingtalk_notion_sync/__init__.py`

- [ ] **Step 1: Write failing tests**

Add tests that import `normalize_record`, `filter_records`, and `sort_records`. Verify strings, arrays, user objects, rich text arrays, attachments, millisecond timestamps, and `所属=活动` filtering.

- [ ] **Step 2: Run tests to verify failure**

Run: `python -m pytest tests/test_records.py -q`
Expected: FAIL because `dingtalk_notion_sync.records` does not exist.

- [ ] **Step 3: Implement `records.py`**

Add normalization helpers and the three public functions.

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/test_records.py -q`
Expected: PASS.

### Task 2: Tests for Notion Payload Builders

**Files:**
- Create: `dingtalk-notion-sync/tests/test_notion_blocks.py`
- Create: `dingtalk-notion-sync/src/dingtalk_notion_sync/notion_blocks.py`

- [ ] **Step 1: Write failing tests**

Verify `properties_from_record`, `detail_blocks_from_record`, and `summary_blocks` build valid Notion payloads using the normalized record shape.

- [ ] **Step 2: Run tests to verify failure**

Run: `python -m pytest tests/test_notion_blocks.py -q`
Expected: FAIL because `notion_blocks.py` does not exist.

- [ ] **Step 3: Implement payload builders**

Add rich text chunking, select/date/url/file properties, detail page blocks, and grouped summary blocks.

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/test_notion_blocks.py -q`
Expected: PASS.

### Task 3: DingTalk API, Notion Client, Config, and Syncer

**Files:**
- Create: `dingtalk-notion-sync/tests/test_syncer.py`
- Create: `dingtalk-notion-sync/src/dingtalk_notion_sync/config.py`
- Create: `dingtalk-notion-sync/src/dingtalk_notion_sync/http.py`
- Create: `dingtalk-notion-sync/src/dingtalk_notion_sync/dingtalk.py`
- Create: `dingtalk-notion-sync/src/dingtalk_notion_sync/notion_client.py`
- Create: `dingtalk-notion-sync/src/dingtalk_notion_sync/syncer.py`
- Create: `dingtalk-notion-sync/sync.py`

- [ ] **Step 1: Write failing syncer tests**

Use fake DingTalk and Notion objects to verify dry-run does not write, non-dry-run creates and updates pages, and the summary page is replaced only after detail records are processed.

- [ ] **Step 2: Run tests to verify failure**

Run: `python -m pytest tests/test_syncer.py -q`
Expected: FAIL because syncer/config/client modules do not exist.

- [ ] **Step 3: Implement API and orchestration modules**

Implement config loading, safe HTTP helper, DingTalk token and pagination, Notion page operations, and `run_sync`.

- [ ] **Step 4: Run syncer tests**

Run: `python -m pytest tests/test_syncer.py -q`
Expected: PASS.

### Task 4: Packaging, Documentation, and Workflow

**Files:**
- Create: `dingtalk-notion-sync/pyproject.toml`
- Create: `dingtalk-notion-sync/requirements.txt`
- Create: `dingtalk-notion-sync/.env.example`
- Create: `dingtalk-notion-sync/README.md`
- Create: `.github/workflows/dingtalk-notion-sync.yml`

- [ ] **Step 1: Add package metadata and dependency files**

Set package source to `src`, include pytest config, and list `requests`, `python-dotenv`, and `pytest`.

- [ ] **Step 2: Add placeholder-only env example**

Include all required and optional environment variables with no real secrets.

- [ ] **Step 3: Add README**

Document Notion schema, GitHub Secrets, local dry run, schedule, and safe secret handling.

- [ ] **Step 4: Add workflow**

Use Python 3.12, install the local package, pass secrets through env, and run `python -u sync.py` from `dingtalk-notion-sync`.

### Task 5: Verification and Commit

**Files:**
- All files under `dingtalk-notion-sync/`
- Plan file under `docs/superpowers/plans/`

- [ ] **Step 1: Run full tests**

Run: `python -m pytest -q`
Expected: all tests pass.

- [ ] **Step 2: Run CLI dry-run help**

Run: `python sync.py --help`
Expected: argparse help prints available flags.

- [ ] **Step 3: Inspect git diff**

Run: `git status --short` and `git diff --stat`
Expected: only the new sync project and plan files changed.

- [ ] **Step 4: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-05-dingtalk-notion-sync.md dingtalk-notion-sync
git commit -m "feat: add dingtalk notion sync"
```
