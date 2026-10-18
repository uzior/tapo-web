import asyncio

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.main import app, shutdown_server


@pytest.mark.parametrize("host,header,allowed", [
    ("127.0.0.1", "shutdown", True), ("::1", "shutdown", True),
    ("192.168.13.50", "shutdown", False), ("127.0.0.1", "", False),
])
def test_shutdown_requires_local_client_and_explicit_header(monkeypatch, host, header, allowed):
    calls = []
    monkeypatch.setattr(app.state, "request_shutdown", lambda: calls.append(True), raising=False)
    request = Request({"type": "http", "client": (host, 1234),
                       "headers": [(b"x-tapo-action", header.encode())]})
    if allowed:
        assert asyncio.run(shutdown_server(request)) == {"stopping": True}
        assert calls == [True]
    else:
        with pytest.raises(HTTPException) as error:
            asyncio.run(shutdown_server(request))
        assert error.value.status_code == 403
        assert not calls
