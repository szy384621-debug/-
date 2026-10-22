#!/usr/bin/env python3
"""通用例句抓取脚本。

按 CSS 选择器从网页（或本地保存的 HTML）中提取例句及译文，去重后输出 JSON。
站点结构变化时只需修改配置里的选择器，无需改代码。

用法示例：
    python3 scrape_sentences.py --config config.example.json
    python3 scrape_sentences.py --url https://example.com/zh --item ".sentence" \
        --sentence ".zh" --translation ".en" --output sentences.json

配置字段见 config.example.json。
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

LOGGER = logging.getLogger("scrape_sentences")

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}


def normalize(text: str) -> str:
    """压缩空白，去掉零宽字符。"""
    text = text.replace("\u200b", "").replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def load_config(path: str) -> dict[str, Any]:
    config_path = Path(path)
    if not config_path.is_file():
        raise SystemExit(f"配置文件不存在: {path}")
    with config_path.open(encoding="utf-8") as fh:
        return json.load(fh)


def merge_config(config: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    """命令行参数优先于配置文件。"""
    if args.url:
        config["urls"] = args.url
    if args.pages is not None:
        config["pages"] = args.pages
    if args.output:
        config["output"] = args.output
    if args.delay is not None:
        config["delay"] = args.delay
    if args.timeout is not None:
        config["timeout"] = args.timeout

    selectors = dict(config.get("selectors") or {})
    for name in ("item", "sentence", "translation", "source", "pinyin"):
        value = getattr(args, name)
        if value:
            selectors[name] = value
    config["selectors"] = selectors

    if not config.get("urls"):
        raise SystemExit("未指定抓取地址：请用 --url 或配置文件中的 urls。")
    if not selectors.get("sentence"):
        raise SystemExit("缺少例句选择器：请设置 selectors.sentence 或 --sentence。")
    return config


def expand_urls(urls: list[str], pages: int) -> list[tuple[str, int]]:
    """展开分页占位符 {page}，返回 (地址, 页码) 列表。"""
    expanded: list[tuple[str, int]] = []
    for url in urls:
        if "{page}" in url:
            for page in range(1, pages + 1):
                expanded.append((url.replace("{page}", str(page)), page))
        else:
            expanded.append((url, 1))
    return expanded


def read_source(url: str, timeout: float, retries: int = 3) -> str:
    """读取网页或本地 HTML，返回文本。网络请求失败时按指数退避重试。"""
    local_path = Path(url[7:]) if url.startswith("file://") else Path(url)
    if (not urlparse(url).scheme or url.startswith("file://")) and local_path.is_file():
        url = str(local_path)
        LOGGER.info("读取本地文件 %s", url)
        raw = Path(url).read_bytes()
        for encoding in ("utf-8", "gb18030"):
            try:
                return raw.decode(encoding)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", errors="replace")

    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            response = requests.get(url, headers=DEFAULT_HEADERS, timeout=timeout)
            response.raise_for_status()
            if not response.encoding or response.encoding.lower() == "iso-8859-1":
                response.encoding = response.apparent_encoding
            LOGGER.info("下载成功 %s（%d 字节）", url, len(response.content))
            return response.text
        except requests.RequestException as exc:
            last_error = exc
            if attempt == retries:
                break
            wait = 2 ** (attempt - 1)
            LOGGER.warning("请求失败（第 %d 次），%d 秒后重试: %s", attempt, wait, exc)
            time.sleep(wait)
    raise RuntimeError(f"抓取失败: {url} -> {last_error}")


def extract_items(html: str, selectors: dict[str, str], url: str, page: int) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    item_selector = selectors.get("item")
    nodes = soup.select(item_selector) if item_selector else [soup]
    if item_selector and not nodes:
        LOGGER.warning("%s 未匹配到任何条目，请检查选择器 %r", url, item_selector)
        return []

    field_names = [
        name for name in ("sentence", "translation", "pinyin", "source") if selectors.get(name)
    ]
    # 选择器里配置的其他字段也一并抓取，便于适配不同站点。
    field_names += [name for name in selectors if name not in {"item", *field_names}]

    items: list[dict[str, Any]] = []
    for node in nodes:
        record: dict[str, Any] = {}
        for field in field_names:
            element = node.select_one(selectors[field])
            if element is None:
                continue
            value = normalize(element.get_text(" ", strip=True))
            if value:
                record[field] = value
        if not record.get("sentence"):
            continue
        record["source_url"] = url
        record["page"] = page
        items.append(record)

    LOGGER.info("%s 提取到 %d 条", url, len(items))
    return items


def deduplicate(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for item in items:
        key = re.sub(r"\s+", "", item["sentence"]).lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def save_json(items: list[dict[str, Any]], output: str, sources: list[str]) -> None:
    output_path = Path(output)
    if output_path.parent and not output_path.parent.exists():
        output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "total": len(items),
        "sources": sources,
        "items": items,
    }
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    LOGGER.info("已写入 %d 条到 %s", len(items), output_path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="按 CSS 选择器抓取例句并输出 JSON",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--config", help="JSON 配置文件路径")
    parser.add_argument("--url", nargs="+", help="一个或多个抓取地址，支持 {page} 占位符")
    parser.add_argument("--pages", type=int, help="分页数量（地址需包含 {page}）")
    parser.add_argument("--output", help="输出 JSON 路径")
    parser.add_argument("--delay", type=float, help="每次请求间隔秒数")
    parser.add_argument("--timeout", type=float, help="单次请求超时秒数")
    parser.add_argument("--item", help="条目容器选择器")
    parser.add_argument("--sentence", help="例句选择器（必填）")
    parser.add_argument("--translation", help="译文选择器")
    parser.add_argument("--pinyin", help="拼音选择器")
    parser.add_argument("--source", help="出处选择器")
    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s", stream=sys.stderr)
    args = build_parser().parse_args(argv)

    config: dict[str, Any] = {}
    if args.config:
        config = load_config(args.config)
    config = merge_config(config, args)

    selectors: dict[str, str] = config["selectors"]
    timeout = float(config.get("timeout", 15))
    delay = float(config.get("delay", 1.0))
    pages = int(config.get("pages", 1))
    output = config.get("output", "sentences.json")

    targets = expand_urls(config["urls"], pages)
    LOGGER.info("共 %d 个页面待抓取", len(targets))

    all_items: list[dict[str, Any]] = []
    sources: list[str] = []
    for index, (url, page) in enumerate(targets):
        try:
            html = read_source(url, timeout)
        except RuntimeError as exc:
            LOGGER.error("%s", exc)
            continue
        sources.append(url)
        all_items.extend(extract_items(html, selectors, url, page))
        if delay > 0 and index < len(targets) - 1:
            time.sleep(delay)

    unique_items = deduplicate(all_items)
    save_json(unique_items, output, sources)
    print(f"完成：抓取 {len(all_items)} 条，去重后 {len(unique_items)} 条 -> {output}")
    return 0 if unique_items else 1


if __name__ == "__main__":
    raise SystemExit(main())
