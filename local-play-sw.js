"use strict";

const DB_NAME = "local-play-vault";
const DB_VERSION = 1;
const GAME_PATH = new URL("./__local-play-game__.html", self.registration.scope).pathname;
const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cache-Control": "no-store"
};

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.pathname !== GAME_PATH) return;

  event.respondWith(serveGame(requestUrl.searchParams.get("game")));
});

function openVault() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      request.transaction.abort();
      reject(new Error("The local game vault is not initialized."));
    };
  });
}

async function readGame(gameKey) {
  const db = await openVault();
  try {
    if (!db.objectStoreNames.contains("chunks")) throw new Error("No saved game chunks.");
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("chunks", "readonly");
      const request = transaction.objectStore("chunks").index("game").getAll(IDBKeyRange.only(gameKey));
      request.onsuccess = () => {
        const rows = request.result || [];
        rows.sort((left, right) => left.index - right.index);
        if (!rows.length) {
          reject(new Error("No saved game chunks."));
          return;
        }
        resolve(new Blob(rows.map((row) => row.data), { type: "text/html" }));
      };
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function serveGame(gameKey) {
  if (gameKey !== "fortnite" && gameKey !== "minecraft") {
    return new Response("Unknown game.", { status: 404, headers: ISOLATION_HEADERS });
  }

  try {
    const html = await readGame(gameKey);
    return new Response(html, {
      status: 200,
      headers: { ...ISOLATION_HEADERS, "Content-Type": "text/html; charset=utf-8" }
    });
  } catch (_) {
    return new Response("The saved game could not be read. Return to the launcher and retry.", {
      status: 404,
      headers: { ...ISOLATION_HEADERS, "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}