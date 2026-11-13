import AppKit
import WebKit

extension AppDelegate {
    func checkBackgroundSmoke(_ completion: @escaping (Error?) -> Void) {
        web.callAsyncJavaScript("""
        let stage = 'open IndexedDB', db;
        try {
        const wait = async predicate => {
          for (let i = 0; i < 120; i++) {
            if (predicate()) return;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          throw new Error('Background smoke timeout: ' + document.querySelector('#background-status')?.textContent);
        };
        db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('minimark-appearance', 1);
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains('settings')) request.result.createObjectStore('settings');
          };
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error('Background database blocked'));
          request.onsuccess = () => resolve(request.result);
        });
        const access = (mode, action) => new Promise((resolve, reject) => {
          const transaction = db.transaction('settings', mode);
          const store = transaction.objectStore('settings');
          let result;
          action(store, value => { result = value; });
          transaction.oncomplete = () => resolve(result);
          transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Background transaction failed'));
        });
          stage = 'write IndexedDB Blob';
          const marker = new Blob(['MINIMARK_IDB_BLOB'], { type: 'text/plain' });
          await access('readwrite', store => store.put(marker, '__mac-smoke-blob'));
          stage = 'read IndexedDB Blob';
          const read = await access('readonly', (store, done) => {
            store.get('__mac-smoke-blob').onsuccess = event => done(event.target.result);
          });
          if (!(read instanceof Blob) || await read.text() !== 'MINIMARK_IDB_BLOB') throw new Error('WKWebView IndexedDB Blob round trip failed');
          await access('readwrite', store => store.delete('__mac-smoke-blob'));
          stage = 'open background dialog';
          document.querySelector('#custom-background').click();
          const dialog = document.querySelector('#background-dialog');
          await wait(() => dialog.open && !dialog.querySelector('[data-action=choose]').disabled);
          stage = 'encode PNG fixture';
          const canvas = document.createElement('canvas');
          canvas.width = 8; canvas.height = 8;
          const context = canvas.getContext('2d');
          context.fillStyle = '#4aa8d4'; context.fillRect(0, 0, 8, 8);
          context.fillStyle = '#eecb52'; context.fillRect(4, 0, 4, 8);
          const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          if (!image) throw new Error('Background PNG fixture unavailable');
          stage = 'assign DataTransfer file';
          const transfer = new DataTransfer();
          transfer.items.add(new File([image], 'mac-smoke-background.png', { type: 'image/png' }));
          const input = document.querySelector('#background-file-input');
          input.files = transfer.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          stage = 'import and decode background';
          const layer = document.querySelector('#theme-background');
          await wait(() => !layer.hidden && layer.complete && layer.naturalWidth > 0 &&
            dialog.getAttribute('aria-busy') === 'false' && document.querySelector('#background-status').textContent === '已保存');
          stage = 'save opacity';
          const slider = document.querySelector('#background-transparency');
          slider.value = '73'; slider.dispatchEvent(new Event('input', { bubbles: true }));
          slider.dispatchEvent(new Event('change', { bubbles: true }));
          await wait(() => document.querySelector('#background-status').textContent === '已保存');
          stage = 'read persisted background';
          const metadata = await access('readonly', (store, done) => {
            store.get('background').onsuccess = event => done(event.target.result);
          });
          const savedImage = await access('readonly', (store, done) => {
            store.get('background-image').onsuccess = event => done(event.target.result);
          });
          if (metadata?.name !== 'mac-smoke-background.png' || metadata.enabled !== true ||
              metadata.transparency !== 73 || !(savedImage instanceof Blob) || savedImage.size < 1 ||
              Math.abs(Number(getComputedStyle(layer).opacity) - 0.27) > 0.01) throw new Error('Background import or persisted metadata failed');
          stage = 'disable background';
          const enabled = document.querySelector('#background-enabled');
          enabled.click();
          await wait(() => layer.hidden && document.querySelector('#background-status').textContent === '已保存');
          stage = 'enable background';
          enabled.click();
          await wait(() => !layer.hidden && document.querySelector('#background-status').textContent === '已保存');
          dialog.querySelector('[data-action=done]').click();
          return { ok: true };
        } catch (error) {
          return { ok: false, stage, error: String(error), stack: String(error?.stack || ''),
            status: document.querySelector('#background-status')?.textContent || '' };
        } finally { db?.close(); }
        """, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value):
                if let response = value as? [String: Any], response["ok"] as? Bool == true {
                    self.checkBackgroundRestoreSmoke(completion)
                } else { completion(Store.failure("Background import smoke: \(String(describing: value))")) }
            case .failure(let error): completion(Store.failure("Background import JavaScript: \(error as NSError)"))
            }
        }
    }

    private func checkBackgroundRestoreSmoke(_ completion: @escaping (Error?) -> Void) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = web.configuration.websiteDataStore
        config.setURLSchemeHandler(AppScheme(root: root), forURLScheme: "moye")
        config.userContentController.addUserScript(WKUserScript(source: "window.chrome = { webview: { addEventListener() {}, postMessage() {} } };",
                                                               injectionTime: .atDocumentStart, forMainFrameOnly: true))
        smokeRestoreWeb = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 600), configuration: config)
        smokeRestoreWeb?.load(URLRequest(url: URL(string: "moye://app/index.html")!))
        func poll(_ remaining: Int) {
            self.smokeRestoreWeb?.evaluateJavaScript("""
            (() => {
              const image = document.querySelector('#theme-background');
              const ok = !!image && !image.hidden && image.complete && image.naturalWidth === 8 &&
                document.querySelector('#background-name')?.textContent === 'mac-smoke-background.png' &&
                document.querySelector('#background-enabled')?.checked === true &&
                document.querySelector('#background-transparency')?.value === '73' &&
                Math.abs(Number(getComputedStyle(image).opacity) - 0.27) < 0.01;
              return { ok, status: document.querySelector('#background-status')?.textContent || '',
                image: image ? { hidden: image.hidden, complete: image.complete, width: image.naturalWidth, source: image.currentSrc } : null,
                name: document.querySelector('#background-name')?.textContent || '',
                transparency: document.querySelector('#background-transparency')?.value || '' };
            })()
            """) { value, error in
                if let response = value as? [String: Any], response["ok"] as? Bool == true {
                    self.smokeRestoreWeb?.stopLoading()
                    self.smokeRestoreWeb = nil
                    self.removeSmokeBackground(completion)
                } else if remaining == 0 {
                    self.smokeRestoreWeb?.stopLoading()
                    self.smokeRestoreWeb = nil
                    completion(Store.failure("Background restore: \(error.map { String(describing: $0 as NSError) } ?? String(describing: value))"))
                } else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { poll(remaining - 1) } }
            }
        }
        poll(100)
    }

    private func removeSmokeBackground(_ completion: @escaping (Error?) -> Void) {
        web.callAsyncJavaScript("""
        let stage = 'remove background', db;
        try {
        document.querySelector('#custom-background').click();
        const dialog = document.querySelector('#background-dialog');
        dialog.querySelector('[data-action=remove]').click();
        for (let index = 0; index < 100; index++) {
          if (document.querySelector('#theme-background').hidden &&
              document.querySelector('#background-status').textContent === '已移除背景') break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!document.querySelector('#theme-background').hidden ||
            document.querySelector('#background-status').textContent !== '已移除背景') throw new Error('Background removal failed');
        stage = 'open IndexedDB after removal';
        db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('minimark-appearance', 1);
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
          stage = 'verify persisted removal';
          await new Promise((resolve, reject) => {
            const transaction = db.transaction('settings');
            let image, metadata;
            transaction.objectStore('settings').get('background-image').onsuccess = event => { image = event.target.result; };
            transaction.objectStore('settings').get('background').onsuccess = event => { metadata = event.target.result; };
            transaction.oncomplete = () => image === undefined && metadata === undefined ? resolve() : reject(new Error('Background removal retained stored data'));
            transaction.onerror = () => reject(transaction.error);
          });
        dialog.querySelector('[data-action=done]').click();
        return { ok: true };
        } catch (error) {
          return { ok: false, stage, error: String(error), stack: String(error?.stack || ''),
            status: document.querySelector('#background-status')?.textContent || '' };
        } finally { db?.close(); }
        """, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value):
                if let response = value as? [String: Any], response["ok"] as? Bool == true {
                    print("PASS macOS background: custom-scheme IndexedDB Blob, PNG import, opacity, toggle, reload restore and removal")
                    completion(nil)
                } else { completion(Store.failure("Background removal smoke: \(String(describing: value))")) }
            case .failure(let error): completion(Store.failure("Background removal JavaScript: \(error as NSError)"))
            }
        }
    }
}
