import pytest

from app import sd


def test_transfer_speed_idle_and_finalization(monkeypatch):
    now = [100.0]
    monkeypatch.setattr(sd.time, "monotonic", lambda: now[0])
    job = sd.Job("1792277350-1792277412", "download")
    assert job.snapshot()["idle_seconds"] is None
    job.start_transfer()
    job.state = "streaming"
    now[0] = 101
    job.received(1_000_000)
    assert job.snapshot()["bytes_per_second"] == 1_000_000
    now[0] = 102
    job.received(1_000_000)
    assert job.snapshot()["received_bytes"] == 2_000_000
    assert job.snapshot()["bytes_per_second"] == 1_000_000
    now[0] = 106
    assert job.snapshot()["bytes_per_second"] == 0
    assert job.snapshot()["idle_seconds"] == 4
    job.state = "finalizing"
    assert job.snapshot()["idle_seconds"] is None
    assert job.snapshot()["bytes_per_second"] == 0


def test_speed_window_excludes_old_burst_and_resets(monkeypatch):
    now = [100.0]
    monkeypatch.setattr(sd.time, "monotonic", lambda: now[0])
    job = sd.Job("1792277350-1792277412", "download")
    job.start_transfer()
    job.state = "streaming"
    for second, size in [(101, 10_000_000), (102, 1_000_000), (103, 1_000_000), (104, 1_000_000)]:
        now[0] = second
        job.received(size)
    assert job.snapshot()["bytes_per_second"] == 1_000_000
    job.start_transfer()
    assert job.snapshot()["received_bytes"] == 0
    assert job.snapshot()["bytes_per_second"] == 0
