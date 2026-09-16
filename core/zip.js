// core/zip.js — 把一个目录打成一个 .zip（Buffer），零依赖：只用 node:zlib 的 deflateRawSync +
// crc32（Node 22 内置，不用再引第三方 zip 库）。只实现 ZIP 格式里"够用"的那部分——单个文件用
// DEFLATE、不分卷、不加密、不搞 zip64（导出目录几十 MB 顶天，远够不上 4GB 的 zip64 门槛）。
// 参考 PKZIP APPNOTE 的最小子集：本地文件头 + 数据 → 每个条目一份；末尾一份中央目录 + 结尾记录。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;

// DOS 日期时间：ZIP 格式的时间戳是这种位打包格式，不是真的关心精确到秒。
function dosDateTime(d) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

// 递归列出 dir 下所有文件，返回 [{ abs, rel }]，rel 用 "/" 分隔（zip 里的路径分隔符固定是 "/"，
// 不管打包机器是不是 Windows）。
function listFiles(dir, baseRel = "") {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const rel = baseRel ? `${baseRel}/${name}` : name;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) out.push(...listFiles(abs, rel));
    else if (stat.isFile()) out.push({ abs, rel });
  }
  return out;
}

// 把整个目录树打成一份 zip，条目路径 = 相对 dir 的路径（用 "/"）。返回 Buffer。
export function zipDirectory(dir) {
  const files = listFiles(dir);
  const { time, date } = dosDateTime(new Date());
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.rel, "utf8");
    const raw = fs.readFileSync(f.abs);
    const compressed = zlib.deflateRawSync(raw, { level: 9 });
    const crc = zlib.crc32(raw);
    const useStore = compressed.length >= raw.length; // 压不小就存原文，省一次解压成本
    const data = useStore ? raw : compressed;
    const method = useStore ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags：bit 11 = 文件名是 UTF-8（画板/文档名常是中文，不设这位有些
    // 工具会当 CP437/本地编码解析，中文文件名会乱码或直接打不开）
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    localChunks.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // flags，跟本地文件头那份一致
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs：普通文件 rw-r--r--（<< 会产生负数，>>> 0 转回无符号）
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralStart = offset;
  const central = Buffer.concat(centralChunks);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // disk with central dir
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localChunks, central, end]);
}

// 读回一份本模块写的 zip：顺序扫本地文件头 + 数据（不查中央目录，够用——本模块自己不写数据描述符
// /分卷，条目在文件里就是紧挨着的）。主要供测试核对 zipDirectory 的产物；真要读任意来源的 zip，
// 应该走完整实现（比如 Node 的 zlib 不带 zip 容器解析，这也是本文件存在的原因）。
export function readZipEntries(buf) {
  const entries = [];
  let o = 0;
  while (o + 4 <= buf.length && buf.readUInt32LE(o) === SIG_LOCAL) {
    const method = buf.readUInt16LE(o + 8);
    const compSize = buf.readUInt32LE(o + 18);
    const nameLen = buf.readUInt16LE(o + 26);
    const extraLen = buf.readUInt16LE(o + 28);
    const nameStart = o + 30;
    const name = buf.toString("utf8", nameStart, nameStart + nameLen);
    const dataStart = nameStart + nameLen + extraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    entries.push({ name, data });
    o = dataStart + compSize;
  }
  return entries;
}
