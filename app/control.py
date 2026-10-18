"""Select the local control protocol; reuse the common recording helpers."""
import os
import re
import time

from pytapo import Tapo

from .tapo_v4 import TapoV4, TapoV4Error


class TapoV3(TapoV4):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._legacy = None
        self._blocked_until = float(os.environ.get("TAPO_CONTROL_BLOCK_UNTIL", "0"))

    def multiple(self, reqs):
        with self._lock:
            remaining = self._blocked_until - time.time()
            if remaining > 0:
                raise TapoV4Error(-40404, f"Logowanie zablokowane. Spróbuj za {int(remaining) + 1} s.")
            try:
                if self._legacy is None:
                    self._legacy = Tapo(
                        self.host, self.username, self.password,
                        cloudPassword=self.password, isKLAP=False,
                        retryStok=False, printWarnInformation=False,
                    )
                response = self._legacy.performRequest({
                    "method": "multipleRequest", "params": {"requests": reqs},
                })
                return response.get("result", {}).get("responses", [])
            except Exception as exc:
                self._legacy = None
                suspension = re.search(r"Try again in (\d+) seconds", str(exc))
                if suspension:
                    seconds = int(suspension.group(1))
                    self._blocked_until = time.time() + seconds
                    raise TapoV4Error(-40404, f"Logowanie zablokowane na {seconds} s.") from None
                # Do not expose library responses, which can contain session data.
                self._blocked_until = time.time() + 60
                raise TapoV4Error(None, "Nie udało się połączyć przez protokół typu 3. "
                                  "Sprawdź hasło konta TP-Link i zgodność z aplikacjami zewnętrznymi.") from None


def create_control(host, password, username="admin"):
    protocol = os.environ.get("TAPO_CONTROL_PROTOCOL", "4")
    if protocol not in ("3", "4"):
        raise TapoV4Error(None, "TAPO_CONTROL_PROTOCOL musi mieć wartość 3 lub 4")
    cls = TapoV3 if protocol == "3" else TapoV4
    return cls(host, password, username=username)
