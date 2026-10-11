import type { Page } from "playwright";

/** Delay a real Player save at the storage boundary, retaining its form owner. */
export async function holdPlayerStorage(page: Page, failure?: string) {
  await page.evaluate((failure) => {
    if (failure) {
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (value, key) {
        if (this.name === "players") {
          IDBObjectStore.prototype.add = add;
          throw new DOMException(failure, "UnknownError");
        }
        return add.call(this, value, key);
      };
    }
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("phase10-db");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("players", "readwrite");
        let held = true;
        window.addEventListener(
          "release-player-storage",
          () => {
            held = false;
          },
          { once: true },
        );
        transaction.oncomplete = () => db.close();
        transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };
        const hold = () => {
          if (held) transaction.objectStore("players").count().onsuccess = hold;
        };
        hold();
        resolve();
      };
    });
  }, failure);
}

export async function releasePlayerStorage(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("release-player-storage")));
}
