const fs = require('fs');
const path = require('path');
const ResEdit = require('resedit');
const { Data, Resource } = ResEdit;

// Paths
const EXE_PATH = path.join(__dirname, '..', 'release', 'win-unpacked', 'Trae Account Manager.exe');
const ICON_PATH = path.join(__dirname, '..', 'resources', 'icon.ico');

// Version info
const [VER_MAJOR, VER_MINOR, VER_PATCH, VER_BUILD] = '1.0.0.0'.split('.').map(n => parseInt(n, 10) || 0);
const PRODUCT_NAME = 'Trae Account Manager';
const DESCRIPTION = 'Traework Multi-Account Manager';
const COPYRIGHT = 'Copyright © 2026 Trae Account Manager';
const COMPANY = 'Trae Account Manager';
const LANG = 1033; // English US
const CODEPAGE = 1200;

function patchExe() {
  if (!fs.existsSync(EXE_PATH)) {
    console.error('EXE not found:', EXE_PATH);
    process.exit(1);
  }
  if (!fs.existsSync(ICON_PATH)) {
    console.error('Icon not found:', ICON_PATH);
    process.exit(1);
  }

  console.log('Reading EXE...');
  const exeData = fs.readFileSync(EXE_PATH);
  const exe = ResEdit.NtExecutable.from(exeData);
  const res = ResEdit.NtExecutableResource.from(exe);

  // 1. Replace icons
  console.log('Replacing icon...');
  const iconFile = Data.IconFile.from(fs.readFileSync(ICON_PATH));
  
  // Remove existing icon resources
  res.entries = res.entries.filter(e => e.type !== 14 /* RT_GROUP_ICON */ && e.type !== 3 /* RT_ICON */);
  
  // Add new icons (using group ID 1, which is electron's app icon)
  Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    1, // icon group ID
    LANG,
    iconFile.icons.map(icon => icon.data)
  );
  console.log('  Icon set with', iconFile.icons.length, 'sizes (16-256px)');

  // 2. Set version info
  console.log('Setting version info...');
  // Remove existing version resources
  res.entries = res.entries.filter(e => e.type !== 16 /* RT_VERSION */);
  
  const vi = Resource.VersionInfo.createEmpty();
  
  // Set version numbers (binary + string)
  vi.setFileVersion(VER_MAJOR, VER_MINOR, VER_PATCH, VER_BUILD, LANG);
  vi.setProductVersion(VER_MAJOR, VER_MINOR, VER_PATCH, VER_BUILD, LANG);
  
  // Set string values
  const langObj = { lang: LANG, codepage: CODEPAGE };
  vi.setStringValues(langObj, {
    CompanyName: COMPANY,
    FileDescription: DESCRIPTION,
    FileVersion: `${VER_MAJOR}.${VER_MINOR}.${VER_PATCH}.${VER_BUILD}`,
    InternalName: PRODUCT_NAME,
    LegalCopyright: COPYRIGHT,
    OriginalFilename: `${PRODUCT_NAME}.exe`,
    ProductName: PRODUCT_NAME,
    ProductVersion: `${VER_MAJOR}.${VER_MINOR}.${VER_PATCH}.${VER_BUILD}`,
  });
  
  // Add translation entry
  vi.replaceAvailableLanguages([langObj]);
  
  // Output to resource entries
  vi.outputToResourceEntries(res.entries);
  console.log('  Version:', `${VER_MAJOR}.${VER_MINOR}.${VER_PATCH}.${VER_BUILD}`);
  console.log('  Product:', PRODUCT_NAME);

  // 3. Write resources back and generate the patched EXE
  console.log('Writing patched EXE...');
  res.outputResource(exe);
  
  const outputBuffer = Buffer.from(exe.generate());
  fs.writeFileSync(EXE_PATH, outputBuffer);
  
  console.log('');
  console.log('SUCCESS! Patched EXE written.');
  console.log('  Path:', EXE_PATH);
  console.log('  Size:', (outputBuffer.length / 1024 / 1024).toFixed(2), 'MB');
}

try {
  patchExe();
} catch (err) {
  console.error('Error patching EXE:', err);
  console.error(err.stack);
  process.exit(1);
}
