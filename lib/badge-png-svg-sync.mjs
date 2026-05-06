import path from "node:path";
import { watch } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";

function isPngBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return false;
  return (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

function isJpegBuffer(buf) {
  return Buffer.isBuffer(buf) && buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8;
}

function readPngDimensions(buf) {
  if (!isPngBuffer(buf)) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

function readJpegDimensions(buf) {
  if (!isJpegBuffer(buf)) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const len = buf.readUInt16BE(offset + 2);
    if (!len || offset + 2 + len > buf.length) break;
    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf
    ) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      if (!width || !height) return null;
      return { width, height };
    }
    offset += 2 + len;
  }
  return null;
}

function readRasterInfo(buf) {
  const png = readPngDimensions(buf);
  if (png) return { ...png, mime: "image/png" };
  const jpg = readJpegDimensions(buf);
  if (jpg) return { ...jpg, mime: "image/jpeg" };
  return null;
}

function svgWrapperForRaster(buffer, mime, width, height) {
  const base64 = buffer.toString("base64");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `  <image href="data:${mime};base64,${base64}" width="${width}" height="${height}" />`,
    `</svg>`,
    "",
  ].join("\n");
}

function badgeSvgPathForPngPath(pngPath) {
  return pngPath.replace(/\.png$/i, ".svg");
}

async function shouldWriteSvg(pngPath, svgPath) {
  try {
    const [pngStats, svgStats] = await Promise.all([stat(pngPath), stat(svgPath)]);
    return Number(svgStats.mtimeMs || 0) < Number(pngStats.mtimeMs || 0);
  } catch {
    return true;
  }
}

export async function writeSvgForBadgePng(pngPath) {
  if (!/\.png$/i.test(String(pngPath || ""))) return false;
  const svgPath = badgeSvgPathForPngPath(pngPath);
  if (!(await shouldWriteSvg(pngPath, svgPath))) return false;

  const png = await readFile(pngPath);
  const info = readRasterInfo(png);
  if (!info) return false;

  const svg = svgWrapperForRaster(png, info.mime, info.width, info.height);
  await writeFile(svgPath, svg, "utf8");
  return true;
}

export async function syncBadgePngsToSvgs(badgeDir) {
  const entries = await readdir(badgeDir, { withFileTypes: true }).catch(() => []);
  for (const ent of entries) {
    if (!ent?.isFile?.()) continue;
    if (!/\.png$/i.test(ent.name)) continue;
    const pngPath = path.join(badgeDir, ent.name);
    try {
      await writeSvgForBadgePng(pngPath);
    } catch {
      // best-effort only
    }
  }
}

export function watchBadgePngsToSvgs(badgeDir) {
  const timers = new Map();
  const scheduleSync = (fileName) => {
    if (!fileName || !/\.png$/i.test(fileName)) return;
    const key = String(fileName);
    if (timers.has(key)) clearTimeout(timers.get(key));
    const t = setTimeout(async () => {
      timers.delete(key);
      try {
        await writeSvgForBadgePng(path.join(badgeDir, key));
      } catch {
        // best-effort only
      }
    }, 200);
    timers.set(key, t);
  };

  const watcher = watch(
    badgeDir,
    {
      persistent: true,
    },
    (_eventType, fileName) => scheduleSync(fileName)
  );
  return watcher;
}

