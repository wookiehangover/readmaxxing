import { strFromU8 } from "fflate";

import { normalizePublicationPath, type PublicationPath } from "../publication-model/paths";
import {
  DEFAULT_ZIP_SECURITY_LIMITS,
  ResourceProviderError,
  ZipEntryPathError,
  ZipFormatError,
  ZipLimitError,
  type ZipSecurityLimits,
} from "./resource-provider-errors";

export interface ZipEntry {
  readonly path: PublicationPath;
  readonly compressionMethod: 0 | 8;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly crc32: number;
  readonly dataOffset: number;
}

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const UTF8_FLAG = 0x0800;
const ENCRYPTION_FLAGS = 0x2041;

export function checkedLimits(overrides: Partial<ZipSecurityLimits> = {}): ZipSecurityLimits {
  const limits = { ...DEFAULT_ZIP_SECURITY_LIMITS, ...overrides };
  const names = Object.keys(limits) as Array<keyof ZipSecurityLimits>;
  for (const name of names) {
    const value = limits[name];
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      (name === "maxEntryCount" && !Number.isInteger(value))
    ) {
      throw new ResourceProviderError("INVALID_OPTIONS", "ZIP security limits must be positive");
    }
  }
  return limits;
}

function assertBounds(offset: number, length: number, total: number): void {
  if (offset < 0 || length < 0 || offset > total - length) {
    throw new ZipFormatError("INVALID_ZIP", "ZIP structure points outside the archive");
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function normalizeEntryPath(value: string, archiveEntry: boolean): PublicationPath {
  if (
    value.includes("\\") ||
    value.includes("\0") ||
    (archiveEntry && (value.includes("?") || value.includes("#")))
  ) {
    throw new ZipEntryPathError();
  }
  const suffixStart = Math.min(
    ...[value.indexOf("?"), value.indexOf("#"), value.length].filter((index) => index >= 0),
  );
  try {
    return normalizePublicationPath(value.slice(0, suffixStart));
  } catch (cause) {
    throw new ZipEntryPathError({ cause });
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView): number {
  const minimum = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  throw new ZipFormatError("INVALID_ZIP", "ZIP end-of-central-directory record is missing");
}

function validateLocalEntry(
  bytes: Uint8Array,
  view: DataView,
  centralOffset: number,
  localOffset: number,
  flags: number,
  method: number,
  compressedSize: number,
  uncompressedSize: number,
  centralName: Uint8Array,
): readonly [dataOffset: number, dataEnd: number] {
  assertBounds(localOffset, 30, bytes.length);
  if (view.getUint32(localOffset, true) !== LOCAL_FILE_SIGNATURE) {
    throw new ZipFormatError("INVALID_ZIP", "ZIP local file header is invalid");
  }
  const localFlags = view.getUint16(localOffset + 6, true);
  const localMethod = view.getUint16(localOffset + 8, true);
  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const nameOffset = localOffset + 30;
  assertBounds(nameOffset, nameLength + extraLength, bytes.length);
  if (
    localFlags !== flags ||
    localMethod !== method ||
    !sameBytes(bytes.subarray(nameOffset, nameOffset + nameLength), centralName)
  ) {
    throw new ZipFormatError("INVALID_ZIP", "ZIP central and local headers disagree");
  }
  if (
    (flags & 0x0008) === 0 &&
    (view.getUint32(localOffset + 18, true) !== compressedSize ||
      view.getUint32(localOffset + 22, true) !== uncompressedSize)
  ) {
    throw new ZipFormatError("INVALID_ZIP", "ZIP entry sizes are inconsistent");
  }
  const dataOffset = nameOffset + nameLength + extraLength;
  const dataEnd = dataOffset + compressedSize;
  assertBounds(dataOffset, compressedSize, bytes.length);
  if (dataEnd > centralOffset) {
    throw new ZipFormatError("INVALID_ZIP", "ZIP entry data overlaps its central directory");
  }
  return [dataOffset, dataEnd];
}

function validateEntryLimits(
  path: PublicationPath,
  compressedSize: number,
  uncompressedSize: number,
  totalUncompressed: number,
  limits: ZipSecurityLimits,
): void {
  if (uncompressedSize > limits.maxEntryUncompressedSize) {
    throw new ZipLimitError(
      "maxEntryUncompressedSize",
      uncompressedSize,
      limits.maxEntryUncompressedSize,
      path,
    );
  }
  if (totalUncompressed > limits.maxTotalUncompressedSize) {
    throw new ZipLimitError(
      "maxTotalUncompressedSize",
      totalUncompressed,
      limits.maxTotalUncompressedSize,
      path,
    );
  }
  const ratio = uncompressedSize === 0 ? 0 : uncompressedSize / compressedSize;
  if (ratio > limits.maxCompressionRatio) {
    throw new ZipLimitError("maxCompressionRatio", ratio, limits.maxCompressionRatio, path);
  }
}

export function parseEntries(
  bytes: Uint8Array,
  limits: ZipSecurityLimits,
): Map<PublicationPath, ZipEntry> {
  if (bytes.length < 22) throw new ZipFormatError("INVALID_ZIP", "ZIP archive is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(bytes, view);
  const disk = view.getUint16(endOffset + 4, true);
  const directoryDisk = view.getUint16(endOffset + 6, true);
  const entriesOnDisk = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  if (disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new ZipFormatError("UNSUPPORTED_ZIP", "Multi-disk ZIP archives are unsupported");
  }
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new ZipFormatError("UNSUPPORTED_ZIP", "ZIP64 archives are unsupported");
  }
  if (entryCount > limits.maxEntryCount) {
    throw new ZipLimitError("maxEntryCount", entryCount, limits.maxEntryCount);
  }
  assertBounds(directoryOffset, directorySize, endOffset);

  const entries = new Map<PublicationPath, ZipEntry>();
  const seen = new Set<PublicationPath>();
  const ranges: Array<readonly [number, number]> = [];
  let totalUncompressed = 0;
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assertBounds(offset, 46, endOffset);
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new ZipFormatError("INVALID_ZIP", "ZIP central directory entry is invalid");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc32 = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const startDisk = view.getUint16(offset + 34, true);
    const localOffset = view.getUint32(offset + 42, true);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    assertBounds(offset, recordLength, directoryOffset + directorySize);
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw new ZipFormatError("UNSUPPORTED_ZIP", "ZIP64 entries are unsupported");
    }
    if (startDisk !== 0 || (flags & ENCRYPTION_FLAGS) !== 0) {
      throw new ZipFormatError("UNSUPPORTED_ZIP", "Encrypted or split ZIP entries are unsupported");
    }
    if (method !== 0 && method !== 8) {
      throw new ZipFormatError("UNSUPPORTED_ZIP", "ZIP compression method is unsupported");
    }
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = strFromU8(nameBytes, (flags & UTF8_FLAG) === 0);
    const path = normalizeEntryPath(name, true);
    if (seen.has(path)) throw new ZipFormatError("INVALID_ZIP", "ZIP contains duplicate paths");
    seen.add(path);
    totalUncompressed += uncompressedSize;
    validateEntryLimits(path, compressedSize, uncompressedSize, totalUncompressed, limits);
    const [dataOffset, dataEnd] = validateLocalEntry(
      bytes,
      view,
      directoryOffset,
      localOffset,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      nameBytes,
    );
    ranges.push([localOffset, dataEnd]);
    if (!name.endsWith("/")) {
      entries.set(path, {
        path,
        compressionMethod: method,
        compressedSize,
        uncompressedSize,
        crc32,
        dataOffset,
      });
    }
    offset += recordLength;
  }
  if (offset !== directoryOffset + directorySize) {
    throw new ZipFormatError("INVALID_ZIP", "ZIP central directory size is inconsistent");
  }
  ranges.sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index]![0] < ranges[index - 1]![1]) {
      throw new ZipFormatError("INVALID_ZIP", "ZIP entries overlap");
    }
  }
  return entries;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ value) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}

export function assertOutput(entry: ZipEntry, output: Uint8Array, limits: ZipSecurityLimits): void {
  if (output.length > limits.maxEntryUncompressedSize) {
    throw new ZipLimitError(
      "maxEntryUncompressedSize",
      output.length,
      limits.maxEntryUncompressedSize,
      entry.path,
    );
  }
  if (output.length !== entry.uncompressedSize || crc32(output) !== entry.crc32) {
    throw new ZipFormatError("INVALID_ZIP", "ZIP entry data does not match its metadata");
  }
}
