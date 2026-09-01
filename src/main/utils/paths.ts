import { app } from 'electron';
import path from 'path';
import fs from 'fs';

// Possible Trae installations, in PRODUCT priority order.
// This manager is built for the TraeWork CN product (TRAE SOLO CN). When
// several Trae products coexist on one machine (TraeCode CN = "Trae CN",
// international "Trae"), account switching must only touch the preferred
// product: closing or re-logging the other products destroys their users'
// active IDE sessions.
export const TRAE_INSTALLATIONS = [
    { name: 'TRAE SOLO CN', appDataDir: 'TRAE SOLO CN', processName: 'TRAE SOLO CN.exe' },
    { name: 'Trae CN', appDataDir: 'Trae CN', processName: 'Trae CN.exe' },
];

export function getTraeStoragePaths(): Array<{
    name: string;
    appDataDir: string;
    storagePath: string;
    backupPath: string;
    processName: string;
}> {
    const appData = app.getPath('appData');
    return TRAE_INSTALLATIONS.map(inst => ({
        name: inst.name,
        appDataDir: inst.appDataDir,
        storagePath: path.join(appData, inst.appDataDir, 'User', 'globalStorage', 'storage.json'),
        backupPath: path.join(appData, inst.appDataDir, 'User', 'globalStorage', 'storage.json.bak'),
        processName: inst.processName,
    }));
}

export function findExistingTraeStorage(): Array<{
    name: string;
    storagePath: string;
    backupPath: string;
    processName: string;
}> {
    return getTraeStoragePaths().filter(p => fs.existsSync(p.storagePath));
}

/**
 * The storage of the PREFERRED Trae product (first installed entry from
 * TRAE_INSTALLATIONS). Account switching, process closing and relaunching
 * must all operate on this single product only.
 */
export function findPreferredTraeStorage(): {
    name: string;
    storagePath: string;
    backupPath: string;
    processName: string;
} | null {
    return findExistingTraeStorage()[0] ?? null;
}

export const PATHS = {
    // App data paths
    APP_DATA: app.getPath('userData'),
    DB_PATH: path.join(app.getPath('userData'), 'data.db'),
};

// Ensure directories exist
export function ensureDirectories(): void {
    const dirs = [
        PATHS.APP_DATA,
        path.dirname(PATHS.DB_PATH),
    ];
    
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}
