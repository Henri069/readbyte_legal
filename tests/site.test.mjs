// Tests for the download page and the creator links. Run with: node --test tests/
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { resolveRequest } from '../tools/preview-server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const STORES_SOURCE = read('assets/stores.js');

const APP_STORE = 'https://apps.apple.com/app/id6812806136';
const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.readbyte.app';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const INSTAGRAM_ON_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22G86 Instagram 390.0.0.0 (iPhone16,2; iOS 18_6; de_DE; de)';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

function fakeElement(attributes = {}) {
  const listeners = {};
  return {
    textContent: '',
    href: '',
    getAttribute: (name) => attributes[name] ?? null,
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
    click: () => listeners.click?.(),
  };
}

/** A browser with stores.js loaded. Records redirects, address bar changes, classes on <html> and listeners. */
function browser({
  userAgent = MAC_SAFARI,
  platform = 'MacIntel',
  maxTouchPoints = 0,
  languages = ['de-DE', 'de'],
  pathname = '/readbyte_legal/c/',
  search = '',
  clipboard,
  /** What the old copy command answers; null when the browser has none. */
  copyCommand = null,
} = {}) {
  const replaced = [];
  const assigned = [];
  const addressBar = [];
  const classes = new Set();
  const listeners = {};
  const selected = [];
  const everSelected = [];
  const copyCommands = [];
  const couponCode = fakeElement();
  const elements = {
    '[data-code]': [couponCode, fakeElement()],
    '.coupon [data-code]': [couponCode],
    '[data-apple-redeem]': [fakeElement(), fakeElement()],
    '[data-play-store]': [fakeElement()],
    '[data-copy-code]': [fakeElement({ 'data-copied-label': 'Kopiert' })],
  };
  const window = {
    navigator: { userAgent, platform, maxTouchPoints, languages, clipboard },
    location: { pathname, search, replace: (url) => replaced.push(url), assign: (url) => assigned.push(url) },
    history: { replaceState: (_state, _title, url) => addressBar.push(url) },
    getSelection: () => ({
      removeAllRanges: () => selected.splice(0),
      addRange: (range) => {
        selected.push(range.node);
        everSelected.push(range.node);
      },
    }),
    document: {
      documentElement: { classList: { add: (...names) => names.forEach((name) => classes.add(name)) } },
      addEventListener: (type, listener) => {
        listeners[type] = listener;
      },
      querySelectorAll: (selector) => elements[selector] ?? [],
      querySelector: (selector) => elements[selector]?.[0] ?? null,
      createRange: () => ({
        selectNodeContents(node) {
          this.node = node;
        },
      }),
      execCommand: (command) => {
        copyCommands.push(command);
        if (copyCommand === null) throw new Error('not supported');
        return copyCommand;
      },
    },
    URLSearchParams,
  };
  window.window = window;
  vm.createContext(window);
  vm.runInContext(STORES_SOURCE, window);
  return {
    stores: window.PageBiteStores,
    replaced,
    assigned,
    addressBar,
    classes,
    elements,
    selected,
    everSelected,
    copyCommands,
    domReady: () => listeners.DOMContentLoaded?.(),
  };
}

/** Lets pending promises (the clipboard) settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

const { stores } = browser();

describe('platform', () => {
  test('iPhones, iPads and in-app browsers on an iPhone count as iOS', () => {
    for (const userAgent of [IPHONE, INSTAGRAM_ON_IPHONE, IPAD]) {
      assert.equal(stores.detectPlatform({ userAgent, platform: 'iPhone', maxTouchPoints: 5 }), 'ios', userAgent);
    }
  });

  test('an iPad asking for the desktop site counts as iOS', () => {
    assert.equal(stores.detectPlatform({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 5 }), 'ios');
  });

  test('Android counts as Android', () => {
    assert.equal(stores.detectPlatform({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5 }), 'android');
  });

  test('computers get the page', () => {
    assert.equal(stores.detectPlatform({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0 }), null);
    assert.equal(stores.detectPlatform({ userAgent: WINDOWS, platform: 'Win32', maxTouchPoints: 0 }), null);
    assert.equal(stores.detectPlatform(undefined), null);
  });
});

describe('download page', () => {
  test('an iPhone goes straight to the App Store and the page stays hidden', () => {
    const page = browser({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 });
    page.stores.startDownloadPage();
    assert.deepEqual(page.replaced, [APP_STORE]);
    assert.deepEqual([...page.classes], ['redirecting', 'redirect-ios']);
  });

  test('an Android phone goes straight to Google Play', () => {
    const page = browser({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5 });
    page.stores.startDownloadPage();
    assert.deepEqual(page.replaced, [PLAY_STORE]);
    assert.deepEqual([...page.classes], ['redirecting', 'redirect-android']);
  });

  test('a computer sees the page with the QR codes', () => {
    const page = browser({ userAgent: WINDOWS, platform: 'Win32' });
    page.stores.startDownloadPage();
    assert.deepEqual(page.replaced, []);
    assert.equal(page.classes.size, 0);
  });
});

describe('creator links', () => {
  test('reads the code from the address, in capitals', () => {
    assert.equal(stores.readCreatorCode('?code=emelie'), 'EMELIE');
    assert.equal(stores.readCreatorCode('?code=%20Books24%20'), 'BOOKS24');
    assert.equal(stores.readCreatorCode('?code=AB'), 'AB');
  });

  test('also reads the code from the short address "c/emelie"', () => {
    assert.equal(stores.readCreatorCode('', '/readbyte_legal/c/emelie'), 'EMELIE');
    assert.equal(stores.readCreatorCode('', '/c/Books24/'), 'BOOKS24');
    assert.equal(stores.readCreatorCode('', '/readbyte_legal/c/'), null);
    // "?code=" wins when both are there.
    assert.equal(stores.readCreatorCode('?code=first', '/c/second'), 'FIRST');
  });

  test('builds the short address for the address bar', () => {
    assert.equal(stores.creatorPath('/readbyte_legal/c/', 'EMELIE'), '/readbyte_legal/c/emelie');
    assert.equal(stores.creatorPath('/readbyte_legal/en/c/index.html', 'EMELIE'), '/readbyte_legal/en/c/emelie');
    assert.equal(stores.creatorPath('/c/', 'BOOKS24'), '/c/books24');
  });

  test('rejects anything Apple custom codes cannot carry', () => {
    for (const search of ['', '?code=', '?code=A', `?code=${'A'.repeat(31)}`, '?code=EMELIE-20', '?code=EMELIE_20', '?code=J%C3%9CRGEN', '?c=EMELIE']) {
      assert.equal(stores.readCreatorCode(search), null, search);
    }
  });

  test('builds the store links with the code', () => {
    assert.equal(stores.appleRedeemUrl('EMELIE'), 'https://apps.apple.com/redeem?ctx=offercodes&id=6812806136&code=EMELIE');
    assert.equal(stores.creatorCampaign('EMELIE'), 'creator-emelie');
    assert.equal(
      stores.playStoreUrl('creator-emelie'),
      `${PLAY_STORE}&referrer=utm_source%3Dpagebite-website%26utm_medium%3Dcreator-link%26utm_campaign%3Dcreator-emelie`,
    );
    assert.equal(stores.playStoreUrl(null), PLAY_STORE);
  });

  test('an iPhone goes straight to Apple’s redeem page with the code filled in', () => {
    const page = browser({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5, search: '?code=emelie' });
    page.stores.startCreatorPage('de');
    assert.deepEqual(page.replaced, ['https://apps.apple.com/redeem?ctx=offercodes&id=6812806136&code=EMELIE']);
    assert.ok(page.classes.has('redirecting'));
    // The note's fallback link gets the same address.
    page.domReady();
    assert.equal(page.elements['[data-apple-redeem]'][0].href, 'https://apps.apple.com/redeem?ctx=offercodes&id=6812806136&code=EMELIE');
  });

  test('an Android phone goes to Google Play with the creator’s campaign, and the page with the code stays behind it', () => {
    const page = browser({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5, search: '?code=emelie' });
    page.stores.startCreatorPage('de');
    // The app reads the campaign after the install and opens the discount by itself.
    assert.deepEqual(page.assigned, [stores.playStoreUrl('creator-emelie')]);
    // The page is not hidden: it stays in the browser behind the Play Store app, with the code.
    assert.deepEqual(page.replaced, []);
    assert.deepEqual([...page.classes], ['platform-android']);
    // The address bar shows the link the creator shared, without "?code=".
    assert.deepEqual(page.addressBar, ['/readbyte_legal/c/emelie']);

    page.domReady();
    assert.deepEqual(
      page.elements['[data-code]'].map((element) => element.textContent),
      ['EMELIE', 'EMELIE'],
    );
    assert.equal(page.elements['[data-play-store]'][0].href, stores.playStoreUrl('creator-emelie'));
  });

  test('sends phones to their store and computers nowhere', () => {
    assert.equal(stores.creatorTarget('ios', 'EMELIE'), 'https://apps.apple.com/redeem?ctx=offercodes&id=6812806136&code=EMELIE');
    assert.equal(stores.creatorTarget('android', 'EMELIE'), stores.playStoreUrl('creator-emelie'));
    assert.equal(stores.creatorTarget(null, 'EMELIE'), null);
  });

  test('an Android browser without German gets the English page first, which then opens Google Play', () => {
    const german = browser({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5, search: '?code=emelie', languages: ['en-US'] });
    german.stores.startCreatorPage('de');
    assert.deepEqual(german.replaced, ['../en/c/?code=emelie']);
    assert.deepEqual(german.assigned, []);

    const english = browser({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5, pathname: '/readbyte_legal/en/c/', search: '?code=emelie', languages: ['en-US'] });
    english.stores.startCreatorPage('en');
    assert.deepEqual(english.assigned, [stores.playStoreUrl('creator-emelie')]);
  });

  test('a computer sees both ways, in English when the browser has no German', () => {
    const german = browser({ search: '?code=emelie' });
    german.stores.startCreatorPage('de');
    assert.deepEqual(german.replaced, []);
    assert.deepEqual(german.assigned, []);
    assert.deepEqual([...german.classes], ['platform-computer']);

    const english = browser({ search: '?code=emelie', languages: ['en-GB', 'fr'] });
    english.stores.startCreatorPage('de');
    assert.deepEqual(english.replaced, ['../en/c/?code=emelie']);

    // The English page never sends anyone back.
    const onEnglishPage = browser({ search: '?code=emelie', languages: ['de-DE'] });
    onEnglishPage.stores.startCreatorPage('en');
    assert.deepEqual(onEnglishPage.replaced, []);
  });

  test('works when a host serves the page at "c/emelie" itself, and leaves that address alone', () => {
    const page = browser({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5, pathname: '/c/emelie' });
    page.stores.startCreatorPage('de');
    assert.deepEqual(page.replaced, []);
    assert.deepEqual(page.addressBar, []);
    page.domReady();
    assert.equal(page.elements['[data-code]'][0].textContent, 'EMELIE');

    // Browsers without German still get the English page, with the code.
    const english = browser({ pathname: '/c/emelie', languages: ['en-US'] });
    english.stores.startCreatorPage('de');
    assert.deepEqual(english.replaced, ['../en/c/?code=emelie']);
  });

  test('without a valid code the visitor gets the download page', () => {
    const page = browser({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5, search: '?code=not-a-code' });
    page.stores.startCreatorPage('de');
    assert.deepEqual(page.replaced, ['../download.html']);

    const bare = browser({ pathname: '/readbyte_legal/c/' });
    bare.stores.startCreatorPage('de');
    assert.deepEqual(bare.replaced, ['../download.html']);
  });

  /** The creator page on an Android phone, with the copy button pressed. */
  async function pressCopy(options) {
    const page = browser({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5, search: '?code=emelie', ...options });
    page.stores.startCreatorPage('de');
    page.domReady();
    const button = page.elements['[data-copy-code]'][0];
    button.click();
    await settle();
    return { page, button };
  }

  test('copies the code with the clipboard and says so', async () => {
    const written = [];
    const { page, button } = await pressCopy({ clipboard: { writeText: async (text) => void written.push(text) } });
    assert.deepEqual(written, ['EMELIE']);
    assert.equal(button.textContent, 'Kopiert');
    assert.deepEqual(page.copyCommands, []);
  });

  test('falls back to the old copy command when an in-app browser blocks the clipboard', async () => {
    const blocked = { writeText: async () => Promise.reject(new Error('Write permission denied')) };
    const { page, button } = await pressCopy({ clipboard: blocked, copyCommand: true });
    assert.deepEqual(page.copyCommands, ['copy']);
    // The old command copies the selection, so the code in the coupon is selected first, and the highlight goes again.
    assert.deepEqual(page.everSelected, [page.elements['.coupon [data-code]'][0]]);
    assert.deepEqual(page.selected, []);
    assert.equal(button.textContent, 'Kopiert');
  });

  test('uses the old copy command where there is no clipboard at all', async () => {
    const { page, button } = await pressCopy({ copyCommand: true });
    assert.deepEqual(page.copyCommands, ['copy']);
    assert.equal(button.textContent, 'Kopiert');
  });

  test('leaves the code selected for the phone’s own copy menu when nothing can copy', async () => {
    for (const copyCommand of [false, null]) {
      const { page, button } = await pressCopy({ copyCommand });
      assert.equal(button.textContent, '', `copy command ${copyCommand}`);
      assert.deepEqual(page.selected, [page.elements['.coupon [data-code]'][0]]);
    }
  });
});

describe('short creator links (404.html)', () => {
  const html = read('404.html');
  const [routeScript, homeScript] = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);

  function visit(pathname, hostname = 'henri069.github.io') {
    const replaced = [];
    const links = [{ href: '/' }, { href: '/' }];
    const context = {
      location: { pathname, hostname, replace: (url) => replaced.push(url) },
      document: { querySelectorAll: () => links },
    };
    vm.createContext(context);
    vm.runInContext(routeScript, context);
    vm.runInContext(homeScript, context);
    return { replaced, home: links[0].href };
  }

  test('"c/emelie" opens the creator page', () => {
    assert.deepEqual(visit('/readbyte_legal/c/emelie').replaced, ['/readbyte_legal/c/?code=emelie']);
    assert.deepEqual(visit('/readbyte_legal/c/Emelie/').replaced, ['/readbyte_legal/c/?code=Emelie']);
    assert.deepEqual(visit('/readbyte_legal/en/c/emelie').replaced, ['/readbyte_legal/en/c/?code=emelie']);
    // On an own domain later.
    assert.deepEqual(visit('/c/emelie', 'pagebite.example').replaced, ['/c/?code=emelie']);
  });

  test('other unknown addresses show "not found" with a link to the start page', () => {
    const missing = visit('/readbyte_legal/unknown.html');
    assert.deepEqual(missing.replaced, []);
    assert.equal(missing.home, '/readbyte_legal/');
    assert.equal(visit('/unknown', 'pagebite.example').home, '/');
    // Never a loop: the creator page's folder itself is no short link.
    assert.deepEqual(visit('/readbyte_legal/x/c/').replaced, []);
  });
});

describe('pages', () => {
  const htmlFiles = (function list(folder) {
    return readdirSync(join(ROOT, folder), { withFileTypes: true }).flatMap((entry) => {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) return ['.git', 'tests', 'tools', 'fonts'].includes(entry.name) ? [] : list(path);
      return entry.name.endsWith('.html') ? [path] : [];
    });
  })('.');

  test('no page loads anything from another server', () => {
    const external = htmlFiles.flatMap((file) =>
      [...read(file).matchAll(/<(?:script|img|link|iframe|source)\b[^>]*\s(?:src|href)="([^"]+)"/g)]
        .map((match) => match[1])
        .filter((url) => /^(?:[a-z]+:)?\/\//i.test(url))
        .map((url) => `${relative(ROOT, join(ROOT, file))}: ${url}`),
    );
    assert.deepEqual(external, []);
  });

  test('every new page exists in German and English', () => {
    for (const page of ['download.html', 'c/index.html']) {
      assert.ok(existsSync(join(ROOT, page)), page);
      assert.ok(existsSync(join(ROOT, 'en', page)), `en/${page}`);
    }
  });

  test('the download pages leave for the store in the head, before the page is drawn', () => {
    for (const [file, script] of [
      ['download.html', './assets/stores.js'],
      ['en/download.html', '../assets/stores.js'],
    ]) {
      const head = read(file).split('<body>')[0];
      assert.ok(head.includes(`<script src="${script}"></script>`), file);
      assert.ok(head.includes('<script>PageBiteStores.startDownloadPage();</script>'), file);
      assert.ok(head.indexOf(script) < head.indexOf('startDownloadPage'), file);
    }
  });

  test('the creator pages start in the head with their own language', () => {
    assert.ok(read('c/index.html').split('<body>')[0].includes("PageBiteStores.startCreatorPage('de');"));
    assert.ok(read('en/c/index.html').split('<body>')[0].includes("PageBiteStores.startCreatorPage('en');"));
    for (const file of ['c/index.html', 'en/c/index.html']) {
      const page = read(file);
      for (const hook of ['data-code', 'data-copy-code', 'data-play-store', 'data-apple-redeem', 'only-computer', 'android-redirect-card']) {
        assert.ok(page.includes(hook), `${file}: ${hook}`);
      }
    }
  });

  test('the Android card of the creator pages names the code for typing it in the app', () => {
    for (const [file, redeem] of [
      ['c/index.html', '„Code einlösen“'],
      ['en/c/index.html', '“Redeem code”'],
    ]) {
      const card = read(file).split('android-redirect-card')[1].split('</section>')[0];
      assert.ok(card.includes('<strong data-code></strong>'), file);
      // The same words as the app's button.
      assert.ok(card.includes(redeem), file);
      assert.ok(card.includes('data-play-store'), file);
    }
  });

  test('the download pages link the same stores as the script', () => {
    assert.equal(stores.APP_STORE_URL, APP_STORE);
    assert.equal(stores.PLAY_STORE_URL, PLAY_STORE);
    for (const file of ['download.html', 'en/download.html']) {
      const page = read(file);
      assert.ok(page.includes(`href="${APP_STORE}"`), file);
      assert.ok(page.includes(`href="${PLAY_STORE}"`), file);
    }
  });

  test('the download pages show the official store badges in their language, with the trademark note', () => {
    for (const [file, language] of [
      ['download.html', 'de'],
      ['en/download.html', 'en'],
    ]) {
      const page = read(file);
      assert.ok(page.includes(`assets/badge-app-store-${language}.svg"`), file);
      assert.ok(page.includes(`assets/badge-google-play-${language}.png"`), file);
      assert.ok(page.includes('class="trademarks"'), file);
    }
    for (const badge of ['badge-app-store-de.svg', 'badge-app-store-en.svg', 'badge-google-play-de.png', 'badge-google-play-en.png']) {
      assert.ok(existsSync(join(ROOT, 'assets', badge)), badge);
    }
    // Apple's badges are drawings only: no scripts and nothing loaded from elsewhere.
    for (const badge of ['badge-app-store-de.svg', 'badge-app-store-en.svg']) {
      assert.doesNotMatch(read(`assets/${badge}`), /<script|href=|url\(|@import|<image/i, badge);
    }
  });

  test('both QR codes are there, as square SVGs with a light background', () => {
    for (const file of ['assets/qr-app-store.svg', 'assets/qr-google-play.svg']) {
      const svg = read(file);
      const size = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
      assert.ok(size && size[1] === size[2], file);
      // Ink modules on a light background, for the best contrast.
      assert.ok(svg.includes('fill="#FBF6EE"') && svg.includes('<path fill="#2B2420"'), file);
    }
    // The terracotta is in the frame, not in the code.
    assert.match(read('style.css'), /\.qr \{[^}]*border: 3px solid var\(--primary\);/);
  });

  test('the start pages link to the download page', () => {
    assert.ok(read('index.html').includes('href="./download.html"'));
    assert.ok(read('en/index.html').includes('href="./download.html"'));
  });
});

describe('local preview (tools/preview-server.mjs) answers like GitHub Pages', () => {
  const answer = (pathname) => {
    const result = resolveRequest(ROOT, pathname);
    return result.file ? { status: result.status, file: relative(ROOT, result.file) } : result;
  };

  test('serves pages with and without ".html", and folders with their index', () => {
    assert.deepEqual(answer('/'), { status: 200, file: 'index.html' });
    assert.deepEqual(answer('/download'), { status: 200, file: 'download.html' });
    assert.deepEqual(answer('/download.html'), { status: 200, file: 'download.html' });
    assert.deepEqual(answer('/en/download'), { status: 200, file: join('en', 'download.html') });
    assert.deepEqual(answer('/c/'), { status: 200, file: join('c', 'index.html') });
    assert.deepEqual(answer('/c'), { status: 301, location: '/c/' });
    assert.deepEqual(answer('/assets/stores.js'), { status: 200, file: join('assets', 'stores.js') });
  });

  test('answers unknown addresses, like the short creator link, with 404.html', () => {
    assert.deepEqual(answer('/c/emily'), { status: 404, file: '404.html' });
    assert.deepEqual(answer('/en/c/emily'), { status: 404, file: '404.html' });
  });

  test('never serves anything outside the website folder', () => {
    for (const path of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc%2fpasswd', '/%00', '/%E0%A4%A']) {
      assert.deepEqual(answer(path), { status: 404, file: '404.html' }, path);
    }
  });
});
