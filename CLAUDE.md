# ScuolaBet

Sito di scommesse scolastiche virtuali. Stack: Vite + Vanilla JS + Firebase.

## Struttura
- `src/main.js` — tutta la logica app
- `src/firebase.js` — config Firebase + AI
- `src/style.css` — tutti gli stili
- `index.html` — HTML statico

## Firebase
- Firestore collections: users, bets, placedBets, people, subjects
- Firebase AI Logic con Gemini per generare scommesse

## Comandi
- `npm run dev` — avvia in locale
- `npm run build` — compila per produzione
- `npm run preview` — anteprima build

## Regole
- Non usare framework CSS esterni
- Tutte le funzioni esposte al browser vanno su `window.nomeFunzione`
- I colori usano le variabili CSS definite in `:root`