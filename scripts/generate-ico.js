const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SOURCE = 'c:\\Users\\zrx-pc\\.trae-cn\\work\\6a7d602177fa0c179d854d5f\\icon_source.jpg';
const OUTPUT = path.join(__dirname, '..', 'resources', 'icon.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function generateIco() {
  const resourcesDir = path.dirname(OUTPUT);
  if (!fs.existsSync(resourcesDir)) {
    fs.mkdirSync(resourcesDir, { recursive: true });
  }

  // Generate PNG buffers at each size
  const images = [];
  for (const size of SIZES) {
    const buffer = await sharp(SOURCE)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    images.push({ size, buffer });
    console.log(`Generated ${size}x${size} PNG: ${buffer.length} bytes`);
  }

  // Build ICO file
  const headerSize = 6;
  const entrySize = 16;
  const numImages = images.length;
  
  // Calculate offsets
  let offset = headerSize + entrySize * numImages;
  const entries = [];
  for (const img of images) {
    entries.push({
      width: img.size >= 256 ? 0 : img.size,
      height: img.size >= 256 ? 0 : img.size,
      colorCount: 0,
      reserved: 0,
      planes: 1,
      bitCount: 32,
      bytesInRes: img.buffer.length,
      imageOffset: offset,
      buffer: img.buffer,
    });
    offset += img.buffer.length;
  }

  // Write ICO
  const icoBuffer = Buffer.alloc(offset);
  let pos = 0;

  // ICONDIR
  icoBuffer.writeUInt16LE(0, pos); pos += 2;  // reserved
  icoBuffer.writeUInt16LE(1, pos); pos += 2;  // type=1 (ICO)
  icoBuffer.writeUInt16LE(numImages, pos); pos += 2;  // count

  // ICONDIRENTRY array
  for (const e of entries) {
    icoBuffer.writeUInt8(e.width, pos); pos += 1;
    icoBuffer.writeUInt8(e.height, pos); pos += 1;
    icoBuffer.writeUInt8(e.colorCount, pos); pos += 1;
    icoBuffer.writeUInt8(e.reserved, pos); pos += 1;
    icoBuffer.writeUInt16LE(e.planes, pos); pos += 2;
    icoBuffer.writeUInt16LE(e.bitCount, pos); pos += 2;
    icoBuffer.writeUInt32LE(e.bytesInRes, pos); pos += 4;
    icoBuffer.writeUInt32LE(e.imageOffset, pos); pos += 4;
  }

  // Image data
  for (const e of entries) {
    e.buffer.copy(icoBuffer, pos);
    pos += e.buffer.length;
  }

  fs.writeFileSync(OUTPUT, icoBuffer);
  console.log(`\nICO written to: ${OUTPUT}`);
  console.log(`Total size: ${icoBuffer.length} bytes`);
  console.log(`Contains ${numImages} sizes: ${SIZES.join(', ')}`);
}

generateIco().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
