# Worms Online

Turowa gra artyleryjska w stylu Worms z multiplayerem przez sieć (2–4 graczy, każdy z własną drużyną robaków).
Całość w TypeScript: autorytatywny serwer Node + klient w przeglądarce (Canvas 2D), bez żadnych plików assetów.

## Szybki start

```bash
npm install
npm run build      # buduje klienta do dist/client
npm start          # serwer na http://localhost:3000 (PORT=xxxx żeby zmienić)
```

Serwer po starcie wypisze adresy w sieci lokalnej, np. `http://192.168.1.10:3000` – koledzy w tej samej
sieci wchodzą na ten adres. Przez internet: przekieruj port, użyj tunelu (`ngrok http 3000`,
`cloudflared tunnel --url http://localhost:3000`) albo wrzuć na Render/Fly/Railway (jest `Dockerfile`).

## Rozwój

```bash
npm run dev        # serwer (3000, tsx watch) + Vite (5173, proxy /ws)
npm test           # testy silnika i serwera (vitest)
npm run typecheck
```

Otwórz http://localhost:5173 w dwóch kartach, w jednej „Stwórz pokój”, w drugiej dołącz kodem.

## Jak grać

1. Wpisz nick, stwórz pokój i podeślij kolegom kod (lub link z `?room=KOD`).
2. Host ustawia mapę (seed, gęstość, motyw), liczbę robaków i czas tury. Gracze klikają „Gotowy”, host „Start”.
3. Drużyny grają na zmianę. W swojej turze masz ograniczony czas na ruch i jeden strzał (shotgun: dwa).
4. Wygrywa ostatnia drużyna z żywym robakiem. Po kilku rundach zaczyna się **nagła śmierć**: woda rośnie,
   a HP wszystkich spada.

## Sterowanie

(uzupełniane poniżej)

## Architektura

Patrz `ARCHITECTURE.md`. Skrót: `shared/engine` – deterministyczna symulacja (teren jako bitmapa, fizyka,
bronie, tury), `server/` – pokoje, lobby, pętla gry 60 Hz, snapshoty 20 Hz, `client/` – render i UI.
