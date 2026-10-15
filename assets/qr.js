/*
 * QR codes built in the browser, for addresses that only exist at runtime (the creator link "code/emelie").
 * Our own encoder after ISO/IEC 18004: byte mode, error correction level M, versions 1 to 10 (up to 213 bytes).
 * Nothing is downloaded or sent anywhere. The fixed QR codes of the download page come from tools/qr-svg.swift.
 */
(function (global) {
  'use strict';

  var MAX_VERSION = 10;
  // Level M, by version (index 0 unused).
  var ECC_CODEWORDS_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  var NUM_ERROR_CORRECTION_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  // Level M in the format information.
  var ECC_FORMAT_BITS = 0;

  function getBit(value, index) {
    return ((value >>> index) & 1) !== 0;
  }

  /** Data and error correction modules of a version, without the function patterns. */
  function numRawDataModules(version) {
    var result = (16 * version + 128) * version + 64;
    if (version >= 2) {
      var numAlign = Math.floor(version / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (version >= 7) result -= 36;
    }
    return result;
  }

  function numDataCodewords(version) {
    return Math.floor(numRawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[version] * NUM_ERROR_CORRECTION_BLOCKS[version];
  }

  function alignmentPositions(version, size) {
    if (version === 1) return [];
    var numAlign = Math.floor(version / 7) + 2;
    var step = Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var position = size - 7; result.length < numAlign; position -= step) result.splice(1, 0, position);
    return result;
  }

  // Reed-Solomon over GF(2^8) with the polynomial 0x11D.
  function gfMultiply(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  function reedSolomonDivisor(degree) {
    var result = [];
    for (var i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    var root = 1;
    for (var k = 0; k < degree; k++) {
      for (var j = 0; j < result.length; j++) {
        result[j] = gfMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gfMultiply(root, 0x02);
    }
    return result;
  }

  function reedSolomonRemainder(data, divisor) {
    var result = divisor.map(function () {
      return 0;
    });
    data.forEach(function (byte) {
      var factor = byte ^ result.shift();
      result.push(0);
      divisor.forEach(function (coefficient, i) {
        result[i] ^= gfMultiply(coefficient, factor);
      });
    });
    return result;
  }

  function utf8Bytes(text) {
    var encoded = unescape(encodeURIComponent(text));
    var bytes = [];
    for (var i = 0; i < encoded.length; i++) bytes.push(encoded.charCodeAt(i));
    return bytes;
  }

  /** The smallest version that holds the bytes, and the data codewords with mode, length and padding. */
  function dataCodewords(bytes) {
    for (var version = 1; version <= MAX_VERSION; version++) {
      var countBits = version <= 9 ? 8 : 16;
      var capacityBits = numDataCodewords(version) * 8;
      if (4 + countBits + bytes.length * 8 > capacityBits) continue;
      var bits = [];
      var append = function (value, length) {
        for (var i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
      };
      append(0x4, 4); // byte mode
      append(bytes.length, countBits);
      bytes.forEach(function (byte) {
        append(byte, 8);
      });
      append(0, Math.min(4, capacityBits - bits.length)); // terminator
      append(0, (8 - (bits.length % 8)) % 8);
      for (var pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) append(pad, 8);
      var codewords = [];
      for (var b = 0; b < bits.length; b += 8) {
        var codeword = 0;
        for (var k = 0; k < 8; k++) codeword = (codeword << 1) | bits[b + k];
        codewords.push(codeword);
      }
      return { version: version, codewords: codewords };
    }
    throw new RangeError('Text too long for a QR code up to version ' + MAX_VERSION);
  }

  /** Splits into blocks, adds the error correction to each and interleaves them. */
  function addEccAndInterleave(version, data) {
    var numBlocks = NUM_ERROR_CORRECTION_BLOCKS[version];
    var blockEccLength = ECC_CODEWORDS_PER_BLOCK[version];
    var rawCodewords = Math.floor(numRawDataModules(version) / 8);
    var numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    var shortBlockLength = Math.floor(rawCodewords / numBlocks);
    var divisor = reedSolomonDivisor(blockEccLength);
    var blocks = [];
    for (var i = 0, k = 0; i < numBlocks; i++) {
      var block = data.slice(k, k + shortBlockLength - blockEccLength + (i < numShortBlocks ? 0 : 1));
      k += block.length;
      var ecc = reedSolomonRemainder(block, divisor);
      if (i < numShortBlocks) block.push(0);
      blocks.push(block.concat(ecc));
    }
    var result = [];
    for (var column = 0; column < blocks[0].length; column++) {
      blocks.forEach(function (row, j) {
        // The short blocks have a placeholder where the long blocks have one more data codeword.
        if (column !== shortBlockLength - blockEccLength || j >= numShortBlocks) result.push(row[column]);
      });
    }
    return result;
  }

  function maskApplies(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  }

  /** The penalty of ISO/IEC 18004 section 7.8.3; the mask with the lowest one is used. */
  function penalty(modules) {
    var size = modules.length;
    var score = 0;
    var line = function (get) {
      for (var a = 0; a < size; a++) {
        var run = 1;
        for (var b = 1; b <= size; b++) {
          if (b < size && get(a, b) === get(a, b - 1)) {
            run++;
          } else {
            if (run >= 5) score += 3 + run - 5;
            run = 1;
          }
        }
        // Finder-like 1:1:3:1:1 with four light modules on one side.
        for (var c = 0; c + 11 <= size; c++) {
          var pattern = '';
          for (var d = 0; d < 11; d++) pattern += get(a, c + d) ? '1' : '0';
          if (pattern === '10111010000' || pattern === '00001011101') score += 40;
        }
      }
    };
    line(function (y, x) {
      return modules[y][x];
    });
    line(function (x, y) {
      return modules[y][x];
    });
    var dark = 0;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (modules[y][x]) dark++;
        if (x + 1 < size && y + 1 < size) {
          var color = modules[y][x];
          if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) score += 3;
        }
      }
    }
    score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return score;
  }

  /** The modules of the QR code for the text, as rows of booleans (true = dark), without the quiet zone. */
  function encode(text) {
    var data = dataCodewords(utf8Bytes(String(text)));
    var version = data.version;
    var size = version * 4 + 17;
    var modules = [];
    var isFunction = [];
    for (var row = 0; row < size; row++) {
      modules.push(new Array(size).fill(false));
      isFunction.push(new Array(size).fill(false));
    }
    var setFunction = function (x, y, dark) {
      modules[y][x] = dark;
      isFunction[y][x] = true;
    };

    for (var i = 0; i < size; i++) {
      setFunction(6, i, i % 2 === 0);
      setFunction(i, 6, i % 2 === 0);
    }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (center) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var x = center[0] + dx;
          var y = center[1] + dy;
          var distance = Math.max(Math.abs(dx), Math.abs(dy));
          if (x >= 0 && x < size && y >= 0 && y < size) setFunction(x, y, distance !== 2 && distance !== 4);
        }
      }
    });
    var positions = alignmentPositions(version, size);
    var last = positions.length - 1;
    positions.forEach(function (ax, a) {
      positions.forEach(function (ay, b) {
        if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) return;
        for (var dy = -2; dy <= 2; dy++) {
          for (var dx = -2; dx <= 2; dx++) setFunction(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      });
    });

    var drawFormat = function (mask) {
      var value = (ECC_FORMAT_BITS << 3) | mask;
      var remainder = value;
      for (var r = 0; r < 10; r++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
      var bits = ((value << 10) | remainder) ^ 0x5412;
      for (var f = 0; f <= 5; f++) setFunction(8, f, getBit(bits, f));
      setFunction(8, 7, getBit(bits, 6));
      setFunction(8, 8, getBit(bits, 7));
      setFunction(7, 8, getBit(bits, 8));
      for (f = 9; f < 15; f++) setFunction(14 - f, 8, getBit(bits, f));
      for (f = 0; f < 8; f++) setFunction(size - 1 - f, 8, getBit(bits, f));
      for (f = 8; f < 15; f++) setFunction(8, size - 15 + f, getBit(bits, f));
      setFunction(8, size - 8, true); // the dark module
    };
    drawFormat(0); // reserves the format areas until the mask is chosen

    if (version >= 7) {
      var remainder = version;
      for (var r = 0; r < 12; r++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
      var versionBits = (version << 12) | remainder;
      for (var v = 0; v < 18; v++) {
        var bit = getBit(versionBits, v);
        var near = size - 11 + (v % 3);
        var far = Math.floor(v / 3);
        setFunction(near, far, bit);
        setFunction(far, near, bit);
      }
    }

    // Codewords in the zigzag from the bottom right, two columns at a time, skipping the vertical timing line.
    var codewords = addEccAndInterleave(version, data.codewords);
    var index = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vertical = 0; vertical < size; vertical++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vertical : vertical;
          if (!isFunction[y][x] && index < codewords.length * 8) {
            modules[y][x] = getBit(codewords[index >>> 3], 7 - (index & 7));
            index++;
          }
        }
      }
    }

    var applyMask = function (mask) {
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          if (!isFunction[y][x] && maskApplies(mask, x, y)) modules[y][x] = !modules[y][x];
        }
      }
    };
    var bestMask = 0;
    var bestPenalty = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      applyMask(mask);
      drawFormat(mask);
      var score = penalty(modules);
      if (score < bestPenalty) {
        bestMask = mask;
        bestPenalty = score;
      }
      applyMask(mask); // undoes it, the mask is its own inverse
    }
    applyMask(bestMask);
    drawFormat(bestMask);
    return modules;
  }

  /** The QR code as SVG, in the same form as tools/qr-svg.swift: dark modules on a light square, 4 modules of margin. */
  function toSvg(text, dark, light) {
    var modules = encode(text);
    var quietZone = 4;
    var total = modules.length + quietZone * 2;
    var path = '';
    modules.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) {
        if (!row[x]) continue;
        var start = x;
        while (x + 1 < row.length && row[x + 1]) x++;
        var length = x - start + 1;
        path += 'M' + (start + quietZone) + ' ' + (y + quietZone) + 'h' + length + 'v1h-' + length + 'z';
      }
    });
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges">' +
      '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/>' +
      '<path fill="' + dark + '" d="' + path + '"/></svg>'
    );
  }

  global.PageBiteQr = { encode: encode, toSvg: toSvg };
})(typeof window !== 'undefined' ? window : this);
