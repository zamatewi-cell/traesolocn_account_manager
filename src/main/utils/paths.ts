import { app } from 'electron';
import path from 'path';
import fs from 'fs';

// Possible Trae installation directories
export const TRAE_INSTALLATIONS = [
    { name: 'Trae CN', appDataDir: 'Trae CN', processName: 'Trae CN.exe' },
    { name: 'TRAE SOLO CN', appDataDir: 'TRAE SOLO CN', processName: 'TRAE SOLO CN.exe' },
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
