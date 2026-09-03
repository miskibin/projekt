# Worms Online

Turowa gra artyleryjska w stylu Worms z multiplayerem przez sieć (2–4 graczy, każdy z własną drużyną robaków).
Całość w TypeScript: autorytatywny serwer Node + klient w przeglądarce (Canvas 2D), bez żadnych plików assetów.

## Szybki start (bez własnego serwera – Vercel/GitHub Pages + Supabase)

Domyślnie gra nie potrzebuje serwera: klient jest statyczną stroną, a gracz tworzący pokój
uruchamia logikę gry u siebie w przeglądarce. Komunikacja idzie przez **Supabase Realtime**
(klucze publiczne w `.env`, projekt `worms-online`). Wystarczy więc hostować `dist/client`:

- **Vercel**: *Add New → Project → Import* `miskibin/projekt`. `vercel.json` ustawia build
  (`npm run build`, katalog `dist/client`). Jeśli nie mergujesz na `main`, w *Settings → Git*
  ustaw *Production Branch* na `claude/worms-multiplayer-game-4rpz13`.
- **GitHub Pages**: workflow `.github/workflows/pages.yml` buduje klienta przy każdym pushu.
  W *Settings → Pages* ustaw *Source: GitHub Actions* (jeśli workflow nie włączył tego sam).

Potem: otwórz stronę, wpisz nick, „Stwórz pokój”, wyślij kolegom link z kodem.

## Własny serwer (opcjonalnie)

```bash
npm install
VITE_TRANSPORT=ws npm run build   # klient łączy się WebSocketem z serwerem Node
npm start                          # http://localhost:3000 (PORT=xxxx żeby zmienić)
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

| Klawisz | Akcja |
|---|---|
| `A`/`D` lub `←`/`→` | chodzenie |
| `W`/`S`, `↑`/`↓` lub mysz | celowanie |
| `Enter` | skok do przodu |
| `Backspace` | salto w tył |
| `Spacja` (przytrzymaj) | ładowanie mocy, puszczenie = strzał (shotgun, uzi, kij, dynamit, mina, jetpack strzelają od razu) |
| `1`–`5` | zapalnik granatów (sekundy) |
| `Tab` lub prawy przycisk myszy | panel broni |
| Lewy przycisk myszy na mapie | cel dla nalotu, teleportu, belki i rakiety naprowadzanej |
| `R` | obrót belki (girder) |
| `F1` | pomiń turę |
| `Esc` | menu (poddanie, wyjście, głośność, pomoc) |
| Kółko myszy, przeciąganie, `Shift`+strzałki | zoom i kamera |

## Bronie i mechaniki

Bazooka (wiatr), granat i granat kasetowy, banan, shotgun (2 strzały), uzi, Święty Granat Ręczny,
dynamit, miny (także losowe na mapie), nalot, rakieta naprowadzana, kij baseballowy, teleport,
belka (girder), jetpack. Do tego: zniszczalny teren, wiatr zmieniany co turę, obrażenia od upadku,
topienie się w wodzie, skrzynki ze zdrowiem/bronią/narzędziami spadające na spadochronach,
nagła śmierć z rosnącą wodą, 4 motywy map (łąka, pustynia, śnieg, piekło) i losowe mapy z seeda.

## Architektura

Patrz `ARCHITECTURE.md`. Skrót: `shared/engine` – deterministyczna symulacja (teren jako bitmapa, fizyka,
bronie, tury), `server/` – pokoje, lobby, pętla gry 60 Hz, snapshoty 20 Hz, `client/` – render i UI.
