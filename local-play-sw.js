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

function readValue(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function serveGame(gameKey) {
  if (gameKey !== "fortnite" && gameKey !== "minecraft") {
    return new Response("Unknown game.", { status: 404, headers: ISOLATION_HEADERS });
  }

  try {
    const db = await openVault();
    if (!db.objectStoreNames.contains("chunks") || !db.objectStoreNames.contains("meta")) {
      db.close();
      throw new Error("The local game vault is incomplete.");
    }

    const meta = await readValue(db, "meta", gameKey);
    const chunkCount = Number(meta && meta.chunks);
    if (!meta || !meta.complete || !Number.isSafeInteger(chunkCount) || chunkCount < 1) {
      db.close();
      throw new Error("The saved game is incomplete.");
    }

    let chunkIndex = 0;
    const body = new ReadableStream({
      async pull(controller) {
        if (chunkIndex >= chunkCount) {
          db.close();
          controller.close();
          return;
        }

        try {
          const row = await readValue(db, "chunks", [gameKey, chunkIndex]);
          if (!row || row.data == null) throw new Error("A saved game chunk is missing.");
          const chunk = row.data instanceof Blob ? row.data : new Blob([row.data]);
          controller.enqueue(new Uint8Array(await chunk.arrayBuffer()));
          chunkIndex += 1;
        } catch (error) {
          db.close();
          controller.error(error);
        }
      },
      cancel() {
        db.close();
      }
    });

    return new Response(body, {
      status: 200,
      headers: {
        ...ISOLATION_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": String(meta.bytes)
      }
    });
  } catch (_) {
    return new Response("The saved game could not be read. Return to the launcher and retry.", {
      status: 404,
      headers: { ...ISOLATION_HEADERS, "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}