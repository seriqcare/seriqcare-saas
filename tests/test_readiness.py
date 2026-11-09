import asyncio
import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-only-readiness-secret")
from backend.main import app


async def call(path):
    messages = []
    sent = False

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await asyncio.sleep(10)
        return {"type": "http.disconnect"}

    async def send(message):
        messages.append(message)

    await app({"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
               "method": "GET", "scheme": "http", "path": path, "raw_path": path.encode(),
               "query_string": b"", "root_path": "", "headers": [],
               "client": ("127.0.0.1", 1), "server": ("test", 80)}, receive, send)
    response = next(message for message in messages if message["type"] == "http.response.start")
    response["body"] = b"".join(message.get("body", b"") for message in messages
                                if message["type"] == "http.response.body")
    return response


class ReadinessTests(unittest.TestCase):
    def test_health_never_connects_to_database(self):
        with patch("backend.main.engine.connect") as connect, patch("backend.middleware.api_access_log._write_to_db") as audit:
            result = asyncio.run(call("/api/health"))
            self.assertEqual(result["status"], 200)
            connect.assert_not_called()
            audit.assert_not_called()

    def test_ready_checks_database_and_disables_cache(self):
        conn = MagicMock()
        context = MagicMock()
        context.__enter__.return_value = conn
        with patch("backend.main.engine.connect", return_value=context):
            result = asyncio.run(call("/api/ready"))
        self.assertEqual(result["status"], 200)
        self.assertEqual(str(conn.execute.call_args.args[0]), "SELECT 1")
        self.assertIn(b"no-store", dict(result["headers"])[b"cache-control"])

    def test_unavailable_database_is_generic_and_uncached(self):
        with patch("backend.main.engine.connect", side_effect=RuntimeError("private database detail")):
            result = asyncio.run(call("/api/ready"))
        self.assertEqual(result["status"], 503)
        self.assertIn(b"no-store", dict(result["headers"])[b"cache-control"])
        self.assertEqual(result["body"], b'{"detail":"Service not ready."}')


if __name__ == "__main__":
    unittest.main()
