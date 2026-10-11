import type { Page } from "playwright";

/** Hold real Round saves at the storage boundary without replacing their owner. */
export async function holdRoundStorage(page: Page, failure?: string) {
  await page.evaluate((failure) => {
    if (failure) {
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (value, key) {
        if (this.name === "rounds") {
          IDBObjectStore.prototype.add = add;
          throw new DOMException(failure, "QuotaExceededError");
        }
        return add.call(this, value, key);
      };
    }
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("phase10-db");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("games", "readwrite");
        let held = true;
        window.addEventListener(
          "release-round-storage",
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
          if (held) transaction.objectStore("games").count().onsuccess = hold;
        };
        hold();
        resolve();
      };
    });
  }, failure);
}

export async function releaseRoundStorage(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("release-round-storage")));
}
