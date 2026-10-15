/*
 * Store links for the download page, the creator links and the friends link.
 * Phones go straight to their store; computers see the page with QR codes.
 * No cookies, no storage, no requests: a creator code only ends up in the store links.
 * The app side of creator codes: readbyte docs/redeem-codes.md.
 */
(function (global) {
  'use strict';

  var APPLE_APP_ID = '6812806136';
  var ANDROID_PACKAGE = 'com.readbyte.app';
  /** Apple's custom offer codes allow capitals and digits only (app: src/domain/subscription/redeem-code.ts). */
  var CREATOR_CODE = /^[A-Z0-9]{2,30}$/;
  /**
   * The friends code behind "pagebite.eu/friends", the link the app shares ("Invite friends", readbyte spec §6.5, §6.8).
   * The app never knows the code: changing it here changes it for every link already sent. It needs the store offers
   * `creator-<code>` (readbyte docs/redeem-codes.md "Friends code"); keep the free time in friends.html in line with them.
   */
  var FRIENDS_CODE = 'FRIENDS';

  /** The published website, for the QR code of a creator link (README "Published address"). */
  var SITE_URL = 'https://pagebite.eu/';
  /** QR code colors, the same as the download page's QR codes: ink on surface. */
  var QR_DARK = '#2B2420';
  var QR_LIGHT = '#FBF6EE';

  /** Without a country, so Apple opens the store of the visitor's country. */
  var APP_STORE_URL = 'https://apps.apple.com/app/id' + APPLE_APP_ID;
  var PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=' + ANDROID_PACKAGE;

  /**
   * Google Play, with a campaign for creator links. Google passes it on as the install referrer and counts installs
   * per campaign in the Play Console (store listing acquisition). Nothing is stored here.
   */
  function playStoreUrl(campaign) {
    if (!campaign) return PLAY_STORE_URL;
    return PLAY_STORE_URL + '&referrer=' + encodeURIComponent('utm_source=pagebite-website&utm_medium=creator-link&utm_campaign=' + campaign);
  }

  /** Apple's own redeem page with the code filled in. It installs the app first when needed. */
  function appleRedeemUrl(code) {
    return 'https://apps.apple.com/redeem?ctx=offercodes&id=' + APPLE_APP_ID + '&code=' + encodeURIComponent(code);
  }

  /**
   * The creator code of the address, in capitals, or null when there is none or it cannot be a code.
   * Creators share "code/emelie". GitHub Pages has no routes, so 404.html hands the code over as "code/?code=emelie";
   * a host with routes may serve this page at "code/emelie" itself.
   */
  function readCreatorCode(search, pathname) {
    var raw = null;
    try {
      raw = new URLSearchParams(search || '').get('code');
    } catch (error) {
      raw = null;
    }
    if (!raw) {
      var match = /\/code\/([^\/]+)\/?$/.exec(String(pathname || ''));
      raw = match ? match[1] : null;
    }
    var code = String(raw || '').trim().toUpperCase();
    return CREATOR_CODE.test(code) ? code : null;
  }

  /** The short address creators share, "…/code/emelie", for the address bar. */
  function creatorPath(pathname, code) {
    return String(pathname || '/').replace(/\/code\/.*$/, '/code/') + code.toLowerCase();
  }

  /**
   * The short creator link on the published website, "https://pagebite.eu/code/emelie". The QR code holds it, so the
   * phone that scans it gets the same way to its store as from the creator's bio.
   */
  function creatorLink(code) {
    return SITE_URL + 'code/' + code.toLowerCase();
  }

  /** The same name as the Play offer ID, so both reports line up. */
  function creatorCampaign(code) {
    return 'creator-' + code.toLowerCase();
  }

  /**
   * 'ios', 'android' or null for a computer. Android first: its user agent is clear, while the iPadOS check
   * (a Mac with a touch screen) also matches desktop browsers that emulate touch.
   */
  function detectPlatform(nav) {
    var userAgent = String((nav && (nav.userAgent || nav.vendor)) || '');
    if (/android/i.test(userAgent)) return 'android';
    if (/iPad|iPhone|iPod/.test(userAgent)) return 'ios';
    if (nav && nav.platform === 'MacIntel' && nav.maxTouchPoints > 1) return 'ios';
    return null;
  }

  /** Where the download page sends a phone, or null to show the page. */
  function downloadTarget(platform) {
    if (platform === 'ios') return APP_STORE_URL;
    if (platform === 'android') return PLAY_STORE_URL;
    return null;
  }

  /**
   * Where a creator link sends a phone, or null for a computer. iPhone: Apple's redeem page with the code filled in.
   * Android: Google Play with the creator's campaign; the app reads it after the install and opens the discount itself.
   */
  function creatorTarget(platform, code) {
    if (platform === 'ios') return appleRedeemUrl(code);
    if (platform === 'android') return playStoreUrl(creatorCampaign(code));
    return null;
  }

  /** True when none of the browser's languages is German. */
  function prefersEnglish(nav) {
    var languages = nav && nav.languages && nav.languages.length ? Array.prototype.slice.call(nav.languages) : [nav && nav.language];
    return !languages.some(function (language) {
      return /^de(-|$)/i.test(String(language || ''));
    });
  }

  function each(selector, callback) {
    Array.prototype.forEach.call(global.document.querySelectorAll(selector), callback);
  }

  /** Leaves for the store. The page stays hidden; only a short note with a link shows if the store takes a moment. */
  function redirect(target, platform) {
    global.document.documentElement.classList.add('redirecting', 'redirect-' + platform);
    global.location.replace(target);
  }

  /** Download page: phones go straight to their store, before the page is drawn. Runs in the head. */
  function startDownloadPage() {
    var platform = detectPlatform(global.navigator);
    var target = downloadTarget(platform);
    if (target) redirect(target, platform);
  }

  function fillCreatorPage(code) {
    each('[data-code]', function (element) {
      element.textContent = code;
    });
    each('[data-apple-redeem]', function (link) {
      link.href = appleRedeemUrl(code);
    });
    each('[data-play-store]', function (link) {
      link.href = playStoreUrl(creatorCampaign(code));
    });
    // The QR code for computers, built here because every creator has their own (assets/qr.js, nothing is loaded).
    if (global.PageBiteQr) {
      each('[data-qr]', function (image) {
        image.src = 'data:image/svg+xml,' + encodeURIComponent(global.PageBiteQr.toSvg(creatorLink(code), QR_DARK, QR_LIGHT));
      });
    }
    var codeElement = global.document.querySelector('.coupon [data-code]');
    each('[data-copy-code]', function (button) {
      button.addEventListener('click', function () {
        copyCode(code, codeElement).then(function (copied) {
          if (copied) button.textContent = button.getAttribute('data-copied-label');
        });
      });
    });
  }

  /**
   * Copies the code. In-app browsers (Instagram, TikTok) often block the clipboard, so the fallback selects the code
   * and tries the old copy command. If that fails too, the code stays selected, ready for the phone's own copy menu.
   * Resolves to whether the code was copied.
   */
  function copyCode(code, codeElement) {
    var viaSelection = function () {
      var selection = global.getSelection ? global.getSelection() : null;
      if (!selection || !codeElement) return false;
      var range = global.document.createRange();
      range.selectNodeContents(codeElement);
      selection.removeAllRanges();
      selection.addRange(range);
      var copied = false;
      try {
        copied = global.document.execCommand('copy') === true;
      } catch (error) {
        copied = false;
      }
      // After a copy the highlight has done its job. Without one it stays, ready for the phone's copy menu.
      if (copied) selection.removeAllRanges();
      return copied;
    };
    var clipboard = global.navigator.clipboard;
    if (!clipboard || !clipboard.writeText) return Promise.resolve(viaSelection());
    return clipboard.writeText(code).then(function () {
      return true;
    }, viaSelection);
  }

  /**
   * Creator link "code/emelie" (404.html hands it over as "code/?code=emelie"). Runs in the head.
   * iPhone: Apple's redeem page, the page stays hidden. Android: Google Play with the creator's campaign, while the page
   * stays behind it with the code and how to type it, for everyone the install link does not reach (the app is already
   * installed, or installed another way). Computers: the page with both ways.
   * `language` is the language of this page; a German page sends browsers without German to the English one.
   */
  function startCreatorPage(language) {
    var address = global.location;
    var code = readCreatorCode(address.search, address.pathname);
    if (!code) {
      address.replace('../download.html');
      return;
    }
    var platform = detectPlatform(global.navigator);
    global.document.addEventListener('DOMContentLoaded', function () {
      fillCreatorPage(code);
    });
    var target = creatorTarget(platform, code);
    if (platform === 'ios' && target) {
      redirect(target, platform);
      return;
    }
    if (language === 'de' && prefersEnglish(global.navigator)) {
      address.replace('../en/code/?code=' + encodeURIComponent(code.toLowerCase()));
      return;
    }
    // The address bar keeps the short link the creator shared, not the "?code=" form.
    if (address.search && global.history && global.history.replaceState) {
      global.history.replaceState(null, '', creatorPath(address.pathname, code));
    }
    global.document.documentElement.classList.add(platform === 'android' ? 'platform-android' : 'platform-computer');
    // Android usually opens the Play Store app on top, and this page stays in the browser with the code.
    if (platform === 'android' && target) address.assign(target);
  }

  /**
   * Friends link "friends" (friends.html, en/friends.html). Runs in the head. Like a creator link with the friends code:
   * iPhone to Apple's redeem page, Android to Google Play with the campaign while the page stays behind it, computers see
   * both ways. `language` is the language of this page; a German page sends browsers without German to the English one.
   */
  function startFriendsPage(language) {
    var address = global.location;
    var platform = detectPlatform(global.navigator);
    global.document.addEventListener('DOMContentLoaded', function () {
      fillCreatorPage(FRIENDS_CODE);
    });
    var target = creatorTarget(platform, FRIENDS_CODE);
    if (platform === 'ios' && target) {
      redirect(target, platform);
      return;
    }
    if (language === 'de' && prefersEnglish(global.navigator)) {
      address.replace('en/friends.html');
      return;
    }
    global.document.documentElement.classList.add(platform === 'android' ? 'platform-android' : 'platform-computer');
    if (platform === 'android' && target) address.assign(target);
  }

  global.PageBiteStores = {
    APP_STORE_URL: APP_STORE_URL,
    PLAY_STORE_URL: PLAY_STORE_URL,
    playStoreUrl: playStoreUrl,
    appleRedeemUrl: appleRedeemUrl,
    readCreatorCode: readCreatorCode,
    creatorPath: creatorPath,
    creatorLink: creatorLink,
    creatorCampaign: creatorCampaign,
    detectPlatform: detectPlatform,
    downloadTarget: downloadTarget,
    creatorTarget: creatorTarget,
    prefersEnglish: prefersEnglish,
    startDownloadPage: startDownloadPage,
    startCreatorPage: startCreatorPage,
    FRIENDS_CODE: FRIENDS_CODE,
    startFriendsPage: startFriendsPage,
  };
})(typeof window !== 'undefined' ? window : this);
