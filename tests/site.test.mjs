// Tests for the download page and the creator links. Run with: node --test tests/
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { resolveRequest } from '../tools/preview-server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const STORES_SOURCE = read('assets/stores.js');
const QR_SOURCE = read('assets/qr.js');

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
    src: '',
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
  pathname = '/readbyte_legal/code/',
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
    '[data-qr]': [fakeElement()],
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
  vm.runInContext(QR_SOURCE, window);
  vm.runInContext(STORES_SOURCE, window);
  return {
    stores: window.PageBiteStores,
    qr: window.PageBiteQr,
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

  test('also reads the code from the short address "code/emelie"', () => {
    assert.equal(stores.readCreatorCode('', '/readbyte_legal/code/emelie'), 'EMELIE');
    assert.equal(stores.readCreatorCode('', '/code/Books24/'), 'BOOKS24');
    assert.equal(stores.readCreatorCode('', '/readbyte_legal/code/'), null);
    assert.equal(stores.readCreatorCode('', '/barcode/emelie'), null);
    // "?code=" wins when both are there.
    assert.equal(stores.readCreatorCode('?code=first', '/code/second'), 'FIRST');
  });

  test('builds the short address for the address bar', () => {
    assert.equal(stores.creatorPath('/readbyte_legal/code/', 'EMELIE'), '/readbyte_legal/code/emelie');
    assert.equal(stores.creatorPath('/readbyte_legal/en/code/index.html', 'EMELIE'), '/readbyte_legal/en/code/emelie');
    assert.equal(stores.creatorPath('/code/', 'BOOKS24'), '/code/books24');
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
    assert.equal(stores.creatorLink('EMELIE'), 'https://pagebite.eu/code/emelie');
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
    assert.deepEqual(page.addressBar, ['/readbyte_legal/code/emelie']);

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
    assert.deepEqual(german.replaced, ['../en/code/?code=emelie']);
    assert.deepEqual(german.assigned, []);

    const english = browser({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5, pathname: '/readbyte_legal/en/code/', search: '?code=emelie', languages: ['en-US'] });
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
    assert.deepEqual(english.replaced, ['../en/code/?code=emelie']);

    // The English page never sends anyone back.
    const onEnglishPage = browser({ search: '?code=emelie', languages: ['de-DE'] });
    onEnglishPage.stores.startCreatorPage('en');
    assert.deepEqual(onEnglishPage.replaced, []);
  });

  test('a computer gets a QR code with the creator link, in ink on surface like the download page', () => {
    const page = browser({ search: '?code=emelie' });
    page.stores.startCreatorPage('de');
    page.domReady();
    const src = page.elements['[data-qr]'][0].src;
    assert.ok(src.startsWith('data:image/svg+xml,'), src);
    const svg = decodeURIComponent(src.slice('data:image/svg+xml,'.length));
    assert.equal(svg, page.qr.toSvg('https://pagebite.eu/code/emelie', '#2B2420', '#FBF6EE'));
    // Nothing that a browser would fetch.
    assert.doesNotMatch(svg, /<script|href=|url\(|<image/i);
  });

  test('works when a host serves the page at "code/emelie" itself, and leaves that address alone', () => {
    const page = browser({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5, pathname: '/code/emelie' });
    page.stores.startCreatorPage('de');
    assert.deepEqual(page.replaced, []);
    assert.deepEqual(page.addressBar, []);
    page.domReady();
    assert.equal(page.elements['[data-code]'][0].textContent, 'EMELIE');

    // Browsers without German still get the English page, with the code.
    const english = browser({ pathname: '/code/emelie', languages: ['en-US'] });
    english.stores.startCreatorPage('de');
    assert.deepEqual(english.replaced, ['../en/code/?code=emelie']);
  });

  test('without a valid code the visitor gets the download page', () => {
    const page = browser({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5, search: '?code=not-a-code' });
    page.stores.startCreatorPage('de');
    assert.deepEqual(page.replaced, ['../download.html']);

    const bare = browser({ pathname: '/readbyte_legal/code/' });
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

describe('friends link (friends.html)', () => {
  const FRIENDS = { pathname: '/friends' };

  test('holds one code that Apple custom codes can carry', () => {
    assert.match(stores.FRIENDS_CODE, /^[A-Z0-9]{2,30}$/);
  });

  test('an iPhone goes straight to Apple’s redeem page with the friends code filled in', () => {
    const page = browser({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5, ...FRIENDS });
    page.stores.startFriendsPage('de');
    assert.deepEqual(page.replaced, [stores.appleRedeemUrl(stores.FRIENDS_CODE)]);
    assert.ok(page.classes.has('redirecting'));
  });

  test('an Android phone goes to Google Play with the code’s campaign, and the page with the code stays behind it', () => {
    const page = browser({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5, ...FRIENDS });
    page.stores.startFriendsPage('de');
    assert.deepEqual(page.assigned, [stores.playStoreUrl(stores.creatorCampaign(stores.FRIENDS_CODE))]);
    assert.deepEqual(page.replaced, []);
    assert.deepEqual([...page.classes], ['platform-android']);
    // The address stays the short link the app shared.
    assert.deepEqual(page.addressBar, []);

    page.domReady();
    assert.deepEqual(
      page.elements['[data-code]'].map((element) => element.textContent),
      [stores.FRIENDS_CODE, stores.FRIENDS_CODE],
    );
  });

  test('a computer sees both ways, in English when the browser has no German', () => {
    const german = browser(FRIENDS);
    german.stores.startFriendsPage('de');
    assert.deepEqual(german.replaced, []);
    assert.deepEqual(german.assigned, []);
    assert.deepEqual([...german.classes], ['platform-computer']);

    const english = browser({ ...FRIENDS, languages: ['en-GB'] });
    english.stores.startFriendsPage('de');
    assert.deepEqual(english.replaced, ['en/friends.html']);

    const onEnglishPage = browser({ pathname: '/en/friends', languages: ['de-DE'] });
    onEnglishPage.stores.startFriendsPage('en');
    assert.deepEqual(onEnglishPage.replaced, []);
  });

  test('both pages start in the head with their own language and promise the same free month', () => {
    for (const [file, language, month] of [
      ['friends.html', 'de', 'einen Monat lang gratis'],
      ['en/friends.html', 'en', 'free for a month'],
    ]) {
      const page = read(file);
      assert.ok(page.split('<body>')[0].includes(`PageBiteStores.startFriendsPage('${language}');`), file);
      for (const hook of ['data-code', 'data-copy-code', 'data-play-store', 'data-apple-redeem', 'only-computer', 'android-redirect-card']) {
        assert.ok(page.includes(hook), `${file}: ${hook}`);
      }
      assert.ok(page.includes(month), file);
      // No price on the page: the store shows it in the visitor's currency before the start.
      assert.doesNotMatch(page, /€|EUR|\$\d/, file);
    }
  });
});

describe('short creator links (404.html)', () => {
  const html = read('404.html');
  const [routeScript, homeScript] = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);

  function visit(pathname, hostname = 'henri069.github.io', search = '') {
    const replaced = [];
    const links = [{ href: '/' }, { href: '/' }];
    const context = {
      location: { pathname, hostname, search, replace: (url) => replaced.push(url) },
      document: { querySelectorAll: () => links },
    };
    vm.createContext(context);
    vm.runInContext(routeScript, context);
    vm.runInContext(homeScript, context);
    return { replaced, home: links[0].href };
  }

  test('"code/emelie" opens the creator page', () => {
    assert.deepEqual(visit('/readbyte_legal/code/emelie').replaced, ['/readbyte_legal/code/?code=emelie']);
    assert.deepEqual(visit('/readbyte_legal/code/Emelie/').replaced, ['/readbyte_legal/code/?code=Emelie']);
    assert.deepEqual(visit('/readbyte_legal/en/code/emelie').replaced, ['/readbyte_legal/en/code/?code=emelie']);
    assert.deepEqual(visit('/code/emelie', 'pagebite.eu').replaced, ['/code/?code=emelie']);
  });

  test('old links with "c/" still open the creator page', () => {
    assert.deepEqual(visit('/c/emelie', 'pagebite.eu').replaced, ['/code/?code=emelie']);
    assert.deepEqual(visit('/readbyte_legal/c/Emelie/').replaced, ['/readbyte_legal/code/?code=Emelie']);
    assert.deepEqual(visit('/en/c/emelie', 'pagebite.eu').replaced, ['/en/code/?code=emelie']);
    // The old long form "c/?code=EMELIE".
    assert.deepEqual(visit('/c/', 'pagebite.eu', '?code=EMELIE').replaced, ['/code/?code=EMELIE']);
    assert.deepEqual(visit('/en/c/index.html', 'pagebite.eu', '?code=EMELIE').replaced, ['/en/code/?code=EMELIE']);
    assert.deepEqual(visit('/c', 'pagebite.eu', '?code=EMELIE').replaced, ['/code/?code=EMELIE']);
  });

  test('other unknown addresses show "not found" with a link to the start page', () => {
    const missing = visit('/readbyte_legal/unknown.html');
    assert.deepEqual(missing.replaced, []);
    assert.equal(missing.home, '/readbyte_legal/');
    assert.equal(visit('/unknown', 'pagebite.example').home, '/');
    // Never a loop: the creator page's folder itself is no short link.
    assert.deepEqual(visit('/readbyte_legal/x/code/').replaced, []);
    assert.deepEqual(visit('/code/', 'pagebite.eu', '?code=EMELIE').replaced, []);
    // Words that only end in "c" or "code" are no creator links.
    assert.deepEqual(visit('/abc/emelie', 'pagebite.eu').replaced, []);
    assert.deepEqual(visit('/barcode/emelie', 'pagebite.eu').replaced, []);
  });
});

describe('QR code (assets/qr.js)', () => {
  const { qr } = browser();
  const finderAt = (modules, top, left) =>
    [0, 1, 2, 3, 4, 5, 6].every((y) =>
      [0, 1, 2, 3, 4, 5, 6].every((x) => {
        const ring = x === 0 || y === 0 || x === 6 || y === 6;
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        return modules[top + y][left + x] === (ring || core);
      }),
    );

  test('builds the same QR code as macOS for the Google Play address of the download page', () => {
    // assets/qr-google-play.svg comes from CoreImage (tools/qr-svg.swift), which read it back. Same data, same mask.
    assert.equal(qr.toSvg(PLAY_STORE, '#2B2420', '#FBF6EE'), read('assets/qr-google-play.svg').trim());
  });

  test('takes the smallest version that holds the text', () => {
    const size = (text) => qr.encode(text).length;
    assert.equal(size('x'.repeat(14)), 21);
    assert.equal(size('x'.repeat(15)), 25);
    assert.equal(size('https://pagebite.eu/code/emelie'), 29);
    // The longest creator code, 30 characters.
    assert.equal(size(`https://pagebite.eu/code/${'a'.repeat(30)}`), 33);
    assert.equal(size('z'.repeat(213)), 57);
    // Characters outside ASCII count as their UTF-8 bytes.
    assert.equal(size('ü'.repeat(7)), 21);
    assert.equal(size('ü'.repeat(8)), 25);
  });

  test('has the finder patterns in three corners, the timing lines and the dark module', () => {
    for (const text of ['https://pagebite.eu/code/emelie', 'z'.repeat(213)]) {
      const modules = qr.encode(text);
      const size = modules.length;
      assert.ok(finderAt(modules, 0, 0) && finderAt(modules, 0, size - 7) && finderAt(modules, size - 7, 0), text);
      assert.ok(!finderAt(modules, size - 7, size - 7), text);
      for (let i = 8; i < size - 8; i++) {
        assert.equal(modules[6][i], i % 2 === 0);
        assert.equal(modules[i][6], i % 2 === 0);
      }
      assert.equal(modules[size - 8][8], true);
    }
  });

  test('refuses text longer than version 10 holds', () => {
    assert.throws(() => qr.encode('z'.repeat(214)), /Text too long/);
  });

  test('draws one square with a 4-module margin', () => {
    const svg = qr.toSvg('https://pagebite.eu/code/emelie', '#2B2420', '#FBF6EE');
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 37 37" shape-rendering="crispEdges">'));
    assert.ok(svg.includes('<rect width="37" height="37" fill="#FBF6EE"/><path fill="#2B2420" d="M4 4h7v1h-7z'));
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
    for (const page of ['download.html', 'code/index.html', 'friends.html']) {
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
    assert.ok(read('code/index.html').split('<body>')[0].includes("PageBiteStores.startCreatorPage('de');"));
    assert.ok(read('en/code/index.html').split('<body>')[0].includes("PageBiteStores.startCreatorPage('en');"));
    for (const file of ['code/index.html', 'en/code/index.html']) {
      const page = read(file);
      for (const hook of ['data-code', 'data-copy-code', 'data-play-store', 'data-apple-redeem', 'only-computer', 'android-redirect-card']) {
        assert.ok(page.includes(hook), `${file}: ${hook}`);
      }
    }
  });

  test('the creator pages show the QR code on computers only, with the encoder loaded before the store script', () => {
    for (const [file, alt] of [
      ['code/index.html', 'QR-Code: dein Creator-Link für PageBite'],
      ['en/code/index.html', 'QR code: your creator link for PageBite'],
    ]) {
      const page = read(file);
      const head = page.split('<body>')[0];
      assert.ok(head.indexOf('assets/qr.js') > -1 && head.indexOf('assets/qr.js') < head.indexOf('assets/stores.js'), file);
      const card = page.split('qr-card')[1].split('</section>')[0];
      assert.ok(page.includes('class="card store qr-card only-computer"'), file);
      assert.ok(card.includes(`<img class="qr" data-qr width="176" height="176" alt="${alt}" />`), file);
    }
  });

  test('the Android card of the creator pages names the code for typing it in the app', () => {
    for (const [file, redeem] of [
      ['code/index.html', '„Code einlösen“'],
      ['en/code/index.html', '“Redeem code”'],
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

describe('start pages (index.html, en/index.html)', () => {
  const PAGES = [
    { file: 'index.html', root: './', lang: 'de', ai: 'KI-erstellt', disclaimer: 'Kann Fehler enthalten. Prüfe den Original-Text.', trademarks: 'Marken von Apple Inc.' },
    { file: 'en/index.html', root: '../', lang: 'en', ai: 'AI-generated', disclaimer: 'Can contain errors. Check the original text.', trademarks: 'trademarks of Apple Inc.' },
  ];
  const sections = (page) => [...page.matchAll(/<section class="([^"]+)"/g)].map((match) => match[1]);

  test('both languages have the same sections in the same order', () => {
    const [german, english] = PAGES.map(({ file }) => read(file));
    assert.ok(sections(german).length >= 7);
    assert.deepEqual(sections(english), sections(german));
    // Same number of drawings, cards and steps.
    for (const hook of ['class="step ', 'class="flashcard', 'class="ai-badge"', 'class="feature', 'class="privacy-item', '<li>']) {
      assert.equal(english.split(hook).length, german.split(hook).length, hook);
    }
  });

  test('load the start page styles and script from this site only, and nothing else changes for the legal pages', () => {
    for (const { file, root } of PAGES) {
      const page = read(file);
      assert.ok(page.includes(`<link rel="stylesheet" href="${root}home.css" />`), file);
      assert.ok(page.includes(`<script src="${root}assets/home.js"></script>`), file);
      // The script that hides parts until they scroll in only runs with home.js behind it.
      assert.ok(page.split('<body')[0].includes("document.documentElement.classList.add('js');"), file);
    }
    for (const file of ['privacy.html', 'terms.html', 'imprint.html', 'delete-account.html', 'download.html']) {
      assert.ok(!read(file).includes('home.css'), file);
      assert.ok(!read(`en/${file}`).includes('home.css'), `en/${file}`);
    }
  });

  test('every drawn AI card is labelled and the hero drawing says it is an illustration (R10, R18)', () => {
    for (const { file, ai, disclaimer } of PAGES) {
      const page = read(file);
      const cards = page.split('class="fc-question"').length - 1;
      assert.equal(cards, 3, file);
      assert.equal(page.split(`<span class="ai-badge">${ai}</span>`).length - 1, cards, file);
      assert.equal(page.split(`<p class="disclaimer">${disclaimer}</p>`).length - 1, 2, file);
      assert.ok(page.includes('<p class="illustration-label" aria-hidden="true">Illustration</p>'), file);
      assert.match(page, /class="stage[^"]*" role="img" aria-label="Illustration: /, file);
    }
  });

  test('show the store badges in their language with the trademark note', () => {
    for (const { file, lang, trademarks } of PAGES) {
      const page = read(file);
      assert.ok(page.includes(`assets/badge-app-store-${lang}.svg"`), file);
      assert.ok(page.includes(`assets/badge-google-play-${lang}.png"`), file);
      assert.ok(page.includes(`href="${APP_STORE}"`) && page.includes(`href="${PLAY_STORE}"`), file);
      assert.ok(page.includes(trademarks), file);
    }
  });

  test('play the video of their own language, small, with a poster and only on demand', () => {
    for (const { file, root, lang } of PAGES) {
      const page = read(file);
      assert.ok(page.includes(`<source src="${root}assets/home/promo-${lang}.mp4" type="video/mp4" />`), file);
      assert.ok(page.includes(`poster="${root}assets/home/promo-poster-${lang}.jpg"`), file);
      assert.match(page, /<video controls preload="none" playsinline /, file);
      assert.doesNotMatch(page, /autoplay/, file);
    }
    for (const lang of ['de', 'en']) {
      const size = statSync(join(ROOT, 'assets', 'home', `promo-${lang}.mp4`)).size;
      assert.ok(size < 3_000_000, `promo-${lang}.mp4 is ${size} bytes`);
    }
  });

  test('promise nothing the app rules forbid', () => {
    for (const { file } of PAGES) {
      const page = read(file).toLowerCase();
      for (const word of ['risk free', 'risikofrei', 'zero data retention', '5 stars', '5 sterne', 'under 2 seconds', 'darwin', 'natural selection', 'never forget', 'nie wieder vergessen']) {
        assert.ok(!page.includes(word), `${file}: ${word}`);
      }
      // The app is never "free"; only the first page is.
      assert.doesNotMatch(page, /free app|kostenlose app|gratis-app/, file);
    }
  });

  test('stand still with Reduce Motion', () => {
    const css = read('home.css');
    const reduced = css.split('@media (prefers-reduced-motion: reduce)')[1];
    assert.ok(reduced, 'home.css has a Reduce Motion block');
    assert.match(reduced, /animation: none !important;/);
    assert.match(reduced, /transition: none !important;/);
    assert.match(reduced, /\.js \.reveal \{\s*opacity: 1;/);
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
    assert.deepEqual(answer('/code/'), { status: 200, file: join('code', 'index.html') });
    assert.deepEqual(answer('/code'), { status: 301, location: '/code/' });
    assert.deepEqual(answer('/assets/stores.js'), { status: 200, file: join('assets', 'stores.js') });
  });

  test('answers unknown addresses, like the short creator link, with 404.html', () => {
    assert.deepEqual(answer('/code/emily'), { status: 404, file: '404.html' });
    assert.deepEqual(answer('/en/code/emily'), { status: 404, file: '404.html' });
    assert.deepEqual(answer('/c/emily'), { status: 404, file: '404.html' });
  });

  test('never serves anything outside the website folder', () => {
    for (const path of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc%2fpasswd', '/%00', '/%E0%A4%A']) {
      assert.deepEqual(answer(path), { status: 404, file: '404.html' }, path);
    }
  });
});
