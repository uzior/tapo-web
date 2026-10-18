import time

import pytest

from app import control
from app.tapo_v4 import TapoV4, TapoV4Error


def test_v4_rejects_error_response_with_result(monkeypatch):
    camera = TapoV4("camera", "unused")
    monkeypatch.setattr(camera, "_post_login", lambda _: {
        "error_code": -40413, "result": {"data": {"encrypt_type": ["3"]}},
    })
    with pytest.raises(TapoV4Error) as error:
        camera.login()
    assert error.value.code == -40413


def test_v3_reuses_common_sd_helpers(monkeypatch):
    monkeypatch.delenv("TAPO_CONTROL_BLOCK_UNTIL", raising=False)
    class FakeTapo:
        def __init__(self, *args, **kwargs):
            pass

        def performRequest(self, request):
            assert request["params"]["requests"][0]["method"] == "getSdCardStatus"
            return {"result": {"responses": [{"error_code": 0, "result": {
                "harddisk_manage": {"hd_info": [{"hd1": {"status": "normal"}}]},
            }}]}}
    monkeypatch.setattr(control, "Tapo", FakeTapo)
    assert control.TapoV3("camera", "unused").get_sd_status() == {"status": "normal"}


def test_blocked_camera_does_not_attempt_login(monkeypatch):
    monkeypatch.setenv("TAPO_CONTROL_BLOCK_UNTIL", str(time.time() + 1800))
    def no_login(*args, **kwargs):
        pytest.fail("Blocked cameras must not be contacted")
    monkeypatch.setattr(control, "Tapo", no_login)
    with pytest.raises(TapoV4Error) as error:
        control.TapoV3("camera", "unused").get_sd_status()
    assert error.value.code == -40404
