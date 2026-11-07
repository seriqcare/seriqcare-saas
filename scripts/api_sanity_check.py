"""Quick API sanity checker for the SeriqCare backend.

This script performs lightweight smoke checks against a FastAPI server by:
- verifying `/docs` and `/openapi.json` are reachable,
- optionally authenticating via `/api/auth/login` (or using a provided bearer token),
- loading the OpenAPI spec and probing safe GET endpoints that do not require
    path parameters or mandatory query parameters,
- reporting each check as PASS, AUTH, SKIP, or FAIL, and returning a non-zero
    exit code if any failures are found.

How to run:
- `python scripts/api_sanity_check.py`
- `python scripts/api_sanity_check.py --base-url http://127.0.0.1:8000`
- `python scripts/api_sanity_check.py --username <user> --password <pass>`
- `python scripts/api_sanity_check.py --token <bearer_token>`
- `$env:NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:8000"; python scripts/api_sanity_check.py`

Example:
- Note:
    `--base-url` is optional when `NEXT_PUBLIC_API_BASE_URL` is set.
- Command:
    `python scripts/api_sanity_check.py --base-url http://127.0.0.1:8000 --username admin --password secret`
- Sample output:
    `[PASS] GET /docs :: Reachable`
    `[PASS] GET /openapi.json :: Reachable`
    `Summary: PASS=12 AUTH=3 SKIP=8 FAIL=0`
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from typing import Any
from urllib import error, parse, request


DEFAULT_BASE_URL = (
    os.getenv("NEXT_PUBLIC_API_BASE_URL")
    or os.getenv("API_BASE_URL")
    or "http://127.0.0.1:8000"
).rstrip("/")


@dataclass
class CheckResult:
    label: str
    status: str
    detail: str


def build_url(base_url: str, path: str, query: dict[str, str] | None = None) -> str:
    url = f"{base_url}{path}"
    if query:
        return f"{url}?{parse.urlencode(query)}"
    return url


def do_request(
    method: str,
    url: str,
    token: str | None = None,
    json_body: dict[str, Any] | None = None,
    timeout: float = 8.0,
) -> tuple[int, str, bytes]:
    data = None
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if json_body is not None:
        data = json.dumps(json_body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = request.Request(url, data=data, headers=headers, method=method.upper())
    try:
        with request.urlopen(req, timeout=timeout) as res:
            return res.status, getattr(res, "reason", "OK"), res.read()
    except error.HTTPError as exc:
        return exc.code, getattr(exc, "reason", "HTTPError"), exc.read()


def fetch_openapi(base_url: str, timeout: float) -> dict[str, Any]:
    url = build_url(base_url, "/openapi.json")
    status, _, body = do_request("GET", url, timeout=timeout)
    if status != 200:
        raise RuntimeError(f"openapi fetch failed with HTTP {status}")
    return json.loads(body.decode("utf-8"))


def maybe_login(base_url: str, username: str | None, password: str | None, timeout: float) -> tuple[str | None, CheckResult | None]:
    if not username or not password:
        return None, None

    url = build_url(base_url, "/api/auth/login")
    status, _, body = do_request(
        "POST",
        url,
        json_body={"username": username, "password": password},
        timeout=timeout,
    )
    if status != 200:
        detail = body.decode("utf-8", errors="ignore")[:240] or f"HTTP {status}"
        return None, CheckResult("POST /api/auth/login", "FAIL", detail)

    payload = json.loads(body.decode("utf-8"))
    token = payload.get("token")
    if not token:
        return None, CheckResult("POST /api/auth/login", "FAIL", "Login response did not include a token")
    return token, CheckResult("POST /api/auth/login", "PASS", f"Authenticated as {payload.get('username', username)}")


def extract_required_query_params(operation: dict[str, Any]) -> list[str]:
    required: list[str] = []
    for param in operation.get("parameters", []):
        if param.get("in") == "query" and param.get("required"):
            required.append(param["name"])
    return required


def has_path_params(path: str) -> bool:
    return "{" in path and "}" in path


def path_requires_auth(operation: dict[str, Any]) -> bool:
    return bool(operation.get("security"))


def check_docs(base_url: str, timeout: float) -> list[CheckResult]:
    results: list[CheckResult] = []
    for path in ("/docs", "/openapi.json"):
        url = build_url(base_url, path)
        status, _, _ = do_request("GET", url, timeout=timeout)
        if status == 200:
            results.append(CheckResult(f"GET {path}", "PASS", "Reachable"))
        else:
            results.append(CheckResult(f"GET {path}", "FAIL", f"HTTP {status}"))
    return results


def check_operations(base_url: str, spec: dict[str, Any], token: str | None, timeout: float) -> list[CheckResult]:
    results: list[CheckResult] = []
    paths = spec.get("paths", {})
    for path, methods in sorted(paths.items()):
        for method, operation in sorted(methods.items()):
            method_upper = method.upper()
            label = f"{method_upper} {path}"

            if method_upper != "GET":
                results.append(CheckResult(label, "SKIP", "Write endpoint not probed by default"))
                continue

            if has_path_params(path):
                results.append(CheckResult(label, "SKIP", "Requires path parameters"))
                continue

            required_query = extract_required_query_params(operation)
            if required_query:
                results.append(CheckResult(label, "SKIP", f"Requires query params: {', '.join(required_query)}"))
                continue

            status, _, body = do_request("GET", build_url(base_url, path), token=token, timeout=timeout)
            if 200 <= status < 300:
                results.append(CheckResult(label, "PASS", f"HTTP {status}"))
                continue

            if status in {401, 403} and path_requires_auth(operation):
                results.append(CheckResult(label, "AUTH", f"HTTP {status} (reachable, auth required)"))
                continue

            detail = body.decode("utf-8", errors="ignore").strip().replace("\n", " ")[:180]
            results.append(CheckResult(label, "FAIL", detail or f"HTTP {status}"))
    return results


def print_results(results: list[CheckResult]) -> int:
    counts = {"PASS": 0, "AUTH": 0, "SKIP": 0, "FAIL": 0}
    for result in results:
        counts[result.status] = counts.get(result.status, 0) + 1
        print(f"[{result.status:<4}] {result.label} :: {result.detail}")

    print()
    print(
        "Summary: "
        f"PASS={counts.get('PASS', 0)} "
        f"AUTH={counts.get('AUTH', 0)} "
        f"SKIP={counts.get('SKIP', 0)} "
        f"FAIL={counts.get('FAIL', 0)}"
    )
    return 1 if counts.get("FAIL", 0) else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Smoke-check the SeriqCare FastAPI backend via /openapi.json.",
    )
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Backend base URL")
    parser.add_argument("--username", default=os.getenv("SANITY_USERNAME"), help="Optional API username")
    parser.add_argument("--password", default=os.getenv("SANITY_PASSWORD"), help="Optional API password")
    parser.add_argument("--token", default=os.getenv("SANITY_BEARER_TOKEN"), help="Optional bearer token")
    parser.add_argument("--timeout", type=float, default=8.0, help="Request timeout in seconds")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    results = check_docs(args.base_url, args.timeout)

    token = args.token
    if not token:
        token, login_result = maybe_login(args.base_url, args.username, args.password, args.timeout)
        if login_result:
            results.append(login_result)

    try:
        spec = fetch_openapi(args.base_url, args.timeout)
    except Exception as exc:
        results.append(CheckResult("GET /openapi.json", "FAIL", str(exc)))
        return print_results(results)

    results.extend(check_operations(args.base_url, spec, token, args.timeout))
    return print_results(results)


if __name__ == "__main__":
    sys.exit(main())