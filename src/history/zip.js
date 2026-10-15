// 使用标准 ZIP 的 UTF-8 文件名和 Deflate 压缩，离线阅读不依赖第三方运行时。
import { deflateRawSync } from 'node:zlib';
const table = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
const crc = data => { let n = 0xffffffff; for (const b of data) n = table[(n ^ b) & 255] ^ n >>> 8; return (n ^ 0xffffffff) >>> 0; };
export function zip(files) {
  const local = [], central = []; let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const filename = Buffer.from(name), original = Buffer.from(value), data = deflateRawSync(original), checksum = crc(original), header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8); header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(original.length, 22); header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(8, 10); directory.writeUInt16LE(0x21, 14);
    directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(original.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, filename, data); central.push(directory, filename); offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
