# Lokalne uruchomienie w Windows

Wymagania: Python 3.12, FFmpeg i ffprobe w PATH.

```powershell
# W folderze pobranego projektu:
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-windows.txt
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Panel: http://localhost:8088. Serwer domyślnie nasłuchuje na 127.0.0.1.
Logi: `logs/server.log` i `logs/server-error.log`.

W ustawieniach panelu (ikona koła zębatego) wpisz adres IP C520WS,
podsieć (np. 192.168.1), login i hasło konta kamery utworzonego w aplikacji
Tapo w ustawieniach zaawansowanych oraz hasło konta TP-Link.
Hasła wpisuj bezpośrednio do lokalnego panelu. Aplikacja zapisuje je w `.env`,
który jest pomijany przez Git. W Windows uprawnienia tego pliku zależą od ACL folderu.

Odczyt SD i podgląd potwierdzono na C520WS z firmware 1.3.5 Build 260522 Rel.14207n.
Lokalne poprawki Windows obejmują transport dźwięku SD przez gniazdo loopback
oraz zatrzymywanie procesu podglądu FFmpeg.

Opcjonalne rozpoznawanie zwierząt nie jest zainstalowane.

## Protokół lokalnego sterowania

C520WS z firmware 1.3.5 Build 260522 deklaruje `encrypt_type: ["3"]`.
Ustawienie `TAPO_CONTROL_PROTOCOL=3` w `.env` wybiera transport biblioteki pytapo.
Domyślna wartość `4` zachowuje protokół SPAKE2+ oryginalnego projektu.
`TAPO_CONTROL_BLOCK_UNTIL` to czas Unix, przed którym aplikacja nie próbuje
logować się do API karty SD. Chroni to kamerę przed ponawianiem prób podczas
czasowej blokady. Po tym terminie można ponownie odświeżyć zakładkę Karta SD.
Odczyt microSD nie wymaga Tapo Care. W aplikacji Tapo włącz zgodność
z aplikacjami zewnętrznymi. Konto kamery i hasło konta TP-Link są osobne.

## Wygodne uruchamianie i zamykanie

Dwukrotne kliknięcie `Uruchom Tapo.bat` uruchamia serwer w tle i otwiera panel.
Zamknięcie przeglądarki nie kończy serwera. Przycisk **Wyłącz serwer** w górnym
pasku panelu pozwala zakończyć aplikację po potwierdzeniu. Jest dostępny lokalnie.

Podczas pobierania SD panel pokazuje prędkość MB/s (średnia z ostatnich trzech
sekund) i informuje o przerwie w odbiorze danych trwającej co najmniej 3 sekundy.
