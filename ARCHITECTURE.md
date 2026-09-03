# Worms Online – architektura

Gra artyleryjska turowa w stylu Worms. Multiplayer przez sieć: serwer Node (autorytatywny),
klienci w przeglądarce (Canvas 2D). Wszystko w TypeScript, jeden pakiet npm.

## Katalogi

- `shared/` – kod współdzielony przez serwer i klienta. **Zero zależności od DOM ani Node.**
  - `constants.ts` – stałe rozgrywki (rozmiar mapy, grawitacja, czasy tur, itd.)
  - `protocol.ts` – typy wiadomości WebSocket klient<->serwer (kontrakt!)
  - `engine/` – deterministyczna symulacja: teren (bitmapa), fizyka robaków i pocisków,
    bronie, tury, wiatr, skrzynki, woda (sudden death), warunki zwycięstwa.
    Publiczne API: `createGame(config, seed)`, `game.step(dt)`, `game.applyInput(playerId, input)`,
    `game.snapshot()`, `game.drainEvents()`, generator terenu `generateTerrain(seed, w, h)`.
- `server/` – Express (statyczne pliki z `dist/client` w produkcji) + `ws`. Pokoje (kody 4-literowe),
  lobby, pętla gry 60 Hz na pokój, broadcast snapshotów 20 Hz + zdarzeń.
  Wejście: `server/index.ts`. Port `PORT` (domyślnie 3000). Ścieżka WS: `/ws`.
- `client/` – Vite. `client/index.html`, `client/src/main.ts`. Lobby (HTML/CSS), gra (Canvas).
  Klient trzyma własną kopię terenu (ten sam seed + zdarzenia eksplozji) i renderuje snapshoty
  z interpolacją. Dźwięki syntezowane WebAudio (brak plików assetów).

## Model sieciowy

1. Klient łączy się na `/ws`, wysyła `hello` (nick), tworzy pokój `createRoom` lub dołącza `joinRoom`.
2. Serwer rozsyła `roomState` (lista graczy, gotowość, ustawienia). Host wysyła `startGame`.
3. Serwer wysyła `gameStart` (seed, config, przypisanie drużyn) – każdy klient generuje teren z seeda.
4. W trakcie gry klient wysyła `input` (stan klawiszy + akcje). Serwer symuluje i wysyła
   `snapshot` (20 Hz) + `events` (eksplozje, obrażenia, komunikaty). Eksplozje modyfikują
   teren deterministycznie po obu stronach (`carveCircle(x, y, r)` – tylko liczby całkowite).
5. Koniec: `gameOver` (zwycięzca, statystyki). Powrót do lobby pokoju.

## Zasady

- Dokładnie jeden aktywny robak na turę; tylko jego właściciel może wysyłać input, który coś zmienia.
- Wszystkie losowania w silniku przez seedowany PRNG (`shared/engine/rng.ts`), nigdy `Math.random`.
- Snapshot ma być mały (pozycje, hp, prędkości, pociski, wiatr, stan tury) – teren NIE jest wysyłany
  w snapshotach (tylko przy `gameStart` seed, a opcjonalnie pełna bitmapa RLE przy `terrainSync`
  gdy gracz dołącza w trakcie / do resynchronizacji).
