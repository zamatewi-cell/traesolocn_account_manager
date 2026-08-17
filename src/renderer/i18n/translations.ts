export type Language = 'en' | 'zh';

export interface Translations {
  // Common
  common: {
    loading: string;
    cancel: string;
    confirm: string;
    save: string;
    delete: string;
    edit: string;
    refresh: string;
    import: string;
    export: string;
    select: string;
    deselect: string;
    selectAll: string;
    clear: string;
    processing: string;
    success: string;
    error: string;
    warning: string;
    unknown: string;
    never: string;
    close: string;
    minimize: string;
    maximize: string;
    restore: string;
  };

  // App title and brand
  app: {
    title: string;
    subtitle: string;
    version: string;
  };

  // Navigation
  nav: {
    accounts: string;
    batchCheckin: string;
    statistics: string;
    settings: string;
    refreshAll: string;
    refreshing: string;
    darkMode: string;
    lightMode: string;
  };

  // Account list page
  accounts: {
    title: string;
    count: (count: number) => string;
    totalCredits: (credits: number) => string;
    checkedInToday: (checked: number, total: number) => string;
    addAccount: string;
    selectedAccounts: (count: number) => string;
    checkinSelected: string;
    noAccounts: string;
    addFirstAccount: string;
    addYourFirstAccount: string;
    active: string;
    credits: string;
    free: string;
    pro: string;
    enterprise: string;
    checkedIn: string;
    notCheckedIn: string;
    lastCheckin: (date: string) => string;
    checkin: string;
    refreshData: string;
    switchToThis: string;
    switching: string;
    deleteAccount: string;
    clickToConfirm: string;
    deselectedAll: string;
    selectAllAccounts: string;
    usageDetails: string;
    usageRecords: string;
    usageRecord: string;
    usageTime: string;
    usageModel: string;
    usageProduct: string;
    usageCredits: string;
    usageTokens: string;
    usageEmpty: string;
    usageLoadFailed: string;
    usageRetry: string;
    usageUpdatedAt: (date: string) => string;
    collapseDetails: string;
    usageDetailsTitle: string;
    usageToday: string;
    usage7Days: string;
    usage30Days: string;
    usageTokensIn: string;
    usageTokensOut: string;
    usageTotalRecords: (total: number) => string;
    usagePrevPage: string;
    usageNextPage: string;
    usagePageInfo: (page: number, pages: number) => string;
    checkinCreditsLabel: string;
    statTotalAccounts: string;
    statTodayUsage: string;
    statRemainingCredits: string;
    statUsageRate: string;
    statTotalUsage: string;
  };

  // Batch checkin page
  batchCheckin: {
    title: string;
    subtitle: string;
    selected: (selected: number, total: number) => string;
    notCheckedIn: (count: number) => string;
    selectUnchecked: string;
    startCheckin: (count: number) => string;
    running: string;
    newlyCheckedIn: string;
    alreadyChecked: string;
    failed: string;
    totalProcessed: string;
    noAccounts: string;
    addAccountsFirst: string;
    checkinSuccess: string;
    alreadyCheckedToday: string;
    checkinFailed: string;
  };

  // Statistics page
  stats: {
    title: string;
    subtitle: string;
    totalAccounts: string;
    totalCredits: string;
    checkedInToday: string;
    proAccounts: string;
    creditsByAccount: string;
    accountStatus: string;
    noAccounts: string;
  };

  // Settings page
  settings: {
    title: string;
    subtitle: string;
    switchSettings: string;
    autoCloseTrae: string;
    autoCloseTraeDescription: string;
    autoRestartTrae: string;
    autoRestartTraeDescription: string;
    traeExePath: string;
    traeExePathDescription: string;
    detectPath: string;
    pathDetected: string;
    pathNotFound: string;
    pathPlaceholder: string;
    dataManagement: string;
    exportAccounts: string;
    exportDescription: string;
    allAccounts: string;
    importAccounts: string;
    importDescription: string;
    about: string;
    version: string;
    accountsStored: string;
    dataLocation: string;
    securityNote: string;
    quickTips: string;
    tip1: string;
    tip2: string;
    tip3: string;
    tip4: string;
    language: string;
    languageDescription: string;
    english: string;
    chinese: string;
  };

  // Add account dialog
  addAccount: {
    title: string;
    oauthLogin: string;
    oauthDescription: string;
    oauthInstructions: string;
    tokenImport: string;
    tokenDescription: string;
    tokenPlaceholder: string;
    tokenHint: string;
    localAccount: string;
    localDescription: string;
    foundLocalAccount: (name: string) => string;
    noLocalAccount: string;
    localLoginFirst: string;
    jsonFile: string;
    jsonDescription: string;
    jsonSelectFile: string;
    jsonHint: string;
    login: string;
    addToken: string;
    importLocal: string;
    selectFile: string;
    processing: string;
    noLocalFoundTip: string;
    loginViaBrowser: string;
    pasteToken: string;
    importFromTrae: string;
    importFromJson: string;
  };

  // Toast messages
  toast: {
    allAccountsRefreshed: string;
    accountAdded: (name: string) => string;
    loggedInAs: (name: string) => string;
    importedLocal: (name: string) => string;
    importedAccounts: (count: number) => string;
    exportedSuccess: string;
    accountDeleted: string;
    switchedTo: (name: string) => string;
    traeRestartFailed: string;
    alreadyCheckedIn: string;
    checkedIn: (credits: number) => string;
    batchComplete: (success: number, already: number, failed: number, total: number) => string;
    openingLogin: string;
    selectAtLeastOne: string;
    closeTraeFirst: string;
    failedLoadAccounts: string;
    failedRefresh: string;
    failedAddAccount: string;
    loginFailed: string;
    failedImportLocal: string;
    importFailed: string;
    exportFailed: string;
    failedDelete: string;
    failedSwitch: string;
    checkinFailed: string;
    batchFailed: string;
    tokenRequired: string;
  };

  // Window controls
  window: {
    title: string;
  };
}

const en: Translations = {
  common: {
    loading: 'Loading...',
    cancel: 'Cancel',
    confirm: 'Confirm',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    refresh: 'Refresh',
    import: 'Import',
    export: 'Export',
    select: 'Select',
    deselect: 'Deselect',
    selectAll: 'Select All',
    clear: 'Clear',
    processing: 'Processing...',
    success: 'Success',
    error: 'Error',
    warning: 'Warning',
    unknown: 'Unknown',
    never: 'Never',
    close: 'Close',
    minimize: 'Minimize',
    maximize: 'Maximize',
    restore: 'Restore',
  },

  app: {
    title: 'Trae Manager',
    subtitle: 'Multi-Account Tool',
    version: 'v1.0.0',
  },

  nav: {
    accounts: 'Accounts',
    batchCheckin: 'Batch Checkin',
    statistics: 'Statistics',
    settings: 'Settings',
    refreshAll: 'Refresh All',
    refreshing: 'Refreshing...',
    darkMode: 'Dark Mode',
    lightMode: 'Light Mode',
  },

  accounts: {
    title: 'My Accounts',
    count: (count) => `${count} accounts`,
    totalCredits: (credits) => `${credits.toLocaleString()} total credits`,
    checkedInToday: (checked, total) => `${checked}/${total} checked in today`,
    addAccount: 'Add Account',
    selectedAccounts: (count) => `${count} accounts selected`,
    checkinSelected: 'Checkin Selected',
    noAccounts: 'No accounts yet',
    addFirstAccount: 'Add your first Trae account...',
    addYourFirstAccount: 'Add Your First Account',
    active: 'Active',
    credits: 'credits',
    free: 'Free',
    pro: 'Pro',
    enterprise: 'Enterprise',
    checkedIn: 'Checked in',
    notCheckedIn: 'Not checked in',
    lastCheckin: (date) => `Last checkin: ${date}`,
    checkin: 'Checkin',
    refreshData: 'Refresh data',
    switchToThis: 'Switch to this account',
    switching: 'Switching...',
    deleteAccount: 'Delete account',
    clickToConfirm: 'Click again to confirm',
    deselectedAll: 'Deselect all',
    selectAllAccounts: 'Select all',
    usageDetails: 'Quota Usage',
    usageRecords: 'Usage Records',
    usageRecord: 'Usage Record',
    usageTime: 'Time',
    usageModel: 'Model',
    usageProduct: 'Product',
    usageCredits: 'Credits',
    usageTokens: 'Tokens',
    usageEmpty: 'No usage records yet',
    usageLoadFailed: 'Failed to load usage records',
    usageRetry: 'Retry',
    usageUpdatedAt: (date) => `Updated: ${date}`,
    collapseDetails: 'Collapse',
    usageDetailsTitle: 'Usage Details',
    usageToday: 'Today',
    usage7Days: '7 Days',
    usage30Days: '30 Days',
    usageTokensIn: 'In',
    usageTokensOut: 'Out',
    usageTotalRecords: (total) => `${total} records`,
    usagePrevPage: 'Prev',
    usageNextPage: 'Next',
    usagePageInfo: (page, pages) => `Page ${page} / ${pages}`,
    checkinCreditsLabel: 'checkin credits',
    statTotalAccounts: 'Accounts',
    statTodayUsage: "Today's Usage",
    statRemainingCredits: 'Remaining Credits',
    statUsageRate: 'Usage Rate',
    statTotalUsage: 'Total Usage',
  },

  batchCheckin: {
    title: 'Batch Checkin',
    subtitle: 'Select accounts and perform daily checkin to claim credits',
    selected: (selected, total) => `Selected: ${selected} / ${total} accounts`,
    notCheckedIn: (count) => `Not checked in: ${count}`,
    selectUnchecked: 'Select Unchecked',
    startCheckin: (count) => `Start Checkin (${count})`,
    running: 'Running...',
    newlyCheckedIn: 'Newly checked in',
    alreadyChecked: 'Already checked',
    failed: 'Failed',
    totalProcessed: 'Total processed',
    noAccounts: 'No accounts added yet.',
    addAccountsFirst: 'Add accounts first to use batch checkin.',
    checkinSuccess: 'Checked in successfully',
    alreadyCheckedToday: 'Already checked in today',
    checkinFailed: 'Checkin failed',
  },

  stats: {
    title: 'Statistics',
    subtitle: 'Overview of your Traework accounts and credits',
    totalAccounts: 'Total Accounts',
    totalCredits: 'Total Credits',
    checkedInToday: 'Checked In Today',
    proAccounts: 'Pro Accounts',
    creditsByAccount: 'Credits by Account',
    accountStatus: 'Account Status',
    noAccounts: 'No accounts yet',
  },

  settings: {
    title: 'Settings',
    subtitle: 'Manage your accounts and application settings',
    switchSettings: 'Account Switching',
    autoCloseTrae: 'Auto-close Trae before switching',
    autoCloseTraeDescription: 'Automatically close Trae, switch the account, then reopen it (like Cockpit)',
    autoRestartTrae: 'Auto-restart Trae after switching',
    autoRestartTraeDescription: 'Launch Trae automatically after the account has been switched',
    traeExePath: 'Trae executable path',
    traeExePathDescription: 'Leave empty to auto-detect. Used to relaunch Trae after switching.',
    detectPath: 'Auto-detect',
    pathDetected: 'Path detected',
    pathNotFound: 'Not found',
    pathPlaceholder: 'e.g. D:\\TRAE SOLO CN\\TRAE SOLO CN.exe',
    dataManagement: 'Data Management',
    exportAccounts: 'Export Accounts',
    exportDescription: 'Export all accounts as a JSON file (includes tokens)',
    allAccounts: 'All accounts',
    importAccounts: 'Import Accounts',
    importDescription: 'Import accounts from a previously exported JSON file',
    about: 'About',
    version: 'Version',
    accountsStored: 'Accounts stored',
    dataLocation: 'Data location',
    securityNote: 'Security note: Exported JSON files contain your authentication tokens in plain text. Keep them secure and never share them with anyone.',
    quickTips: 'Quick Tips',
    tip1: 'Close Traework completely before switching accounts to avoid conflicts',
    tip2: 'Use batch checkin daily to quickly collect credits across all accounts',
    tip3: 'Export your accounts regularly as a backup',
    tip4: 'Daily checkin rewards 200 Work-exclusive credits per account',
    language: 'Language',
    languageDescription: 'Choose your preferred display language',
    english: 'English',
    chinese: '简体中文',
  },

  addAccount: {
    title: 'Add Account',
    oauthLogin: 'OAuth Login',
    oauthDescription: 'Login via browser window',
    oauthInstructions: 'Click the button below to open the Trae login window. A browser window will pop up for you to complete login.',
    tokenImport: 'Token Import',
    tokenDescription: 'Paste token manually',
    tokenPlaceholder: 'Paste your token here...',
    tokenHint: 'You can find your token in browser DevTools or Trae storage',
    localAccount: 'Local Account',
    localDescription: 'Import from Traework',
    foundLocalAccount: (name) => `Found local account: ${name}`,
    noLocalAccount: 'No local account found',
    localLoginFirst: 'Please log in to Traework first, then restart this app',
    jsonFile: 'JSON File',
    jsonDescription: 'Import from JSON file',
    jsonSelectFile: 'Select a previously exported JSON file...',
    jsonHint: 'Import accounts from an exported JSON backup file',
    login: 'Login',
    addToken: 'Add Token',
    importLocal: 'Import',
    selectFile: 'Select File',
    processing: 'Processing...',
    noLocalFoundTip: 'No local account found. Please log in to Traework first.',
    loginViaBrowser: 'Login via browser window',
    pasteToken: 'Paste token manually',
    importFromTrae: 'Import from Traework',
    importFromJson: 'Import from JSON file',
  },

  toast: {
    allAccountsRefreshed: 'All accounts refreshed',
    accountAdded: (name) => `Account "${name}" added successfully`,
    loggedInAs: (name) => `Logged in as "${name}"`,
    importedLocal: (name) => `Imported local account "${name}"`,
    importedAccounts: (count) => `Imported ${count} account(s)`,
    exportedSuccess: 'Accounts exported successfully',
    accountDeleted: 'Account deleted',
    switchedTo: (name) => `Switched to "${name}"`,
    traeRestartFailed: 'Account switched, but Trae could not be restarted (executable not found). Please set the Trae path in Settings.',
    alreadyCheckedIn: 'Already checked in today',
    checkedIn: (credits) => `Checked in! +${credits} credits`,
    batchComplete: (success, already, failed, total) => `Batch checkin complete: ${success} checked in, ${already} already done, ${failed} failed (${total} total)`,
    openingLogin: 'Opening login window...',
    selectAtLeastOne: 'Select at least one account',
    closeTraeFirst: 'Please close Traework before switching accounts',
    failedLoadAccounts: 'Failed to load accounts',
    failedRefresh: 'Failed to refresh accounts',
    failedAddAccount: 'Failed to add account',
    loginFailed: 'Login failed',
    failedImportLocal: 'Failed to import local account',
    importFailed: 'Import failed',
    exportFailed: 'Export failed',
    failedDelete: 'Failed to delete account',
    failedSwitch: 'Failed to switch account',
    checkinFailed: 'Checkin failed',
    batchFailed: 'Batch checkin failed',
    tokenRequired: 'Please enter a token',
  },

  window: {
    title: 'Trae Account Manager',
  },
};

const zh: Translations = {
  common: {
    loading: '加载中...',
    cancel: '取消',
    confirm: '确认',
    save: '保存',
    delete: '删除',
    edit: '编辑',
    refresh: '刷新',
    import: '导入',
    export: '导出',
    select: '选择',
    deselect: '取消选择',
    selectAll: '全选',
    clear: '清除',
    processing: '处理中...',
    success: '成功',
    error: '错误',
    warning: '警告',
    unknown: '未知',
    never: '从未',
    close: '关闭',
    minimize: '最小化',
    maximize: '最大化',
    restore: '还原',
  },

  app: {
    title: 'Trae 管理器',
    subtitle: '多账号工具',
    version: 'v1.0.0',
  },

  nav: {
    accounts: '账号列表',
    batchCheckin: '批量签到',
    statistics: '数据统计',
    settings: '设置',
    refreshAll: '全部刷新',
    refreshing: '刷新中...',
    darkMode: '深色模式',
    lightMode: '浅色模式',
  },

  accounts: {
    title: '我的账号',
    count: (count) => `${count} 个账号`,
    totalCredits: (credits) => `共 ${credits.toLocaleString()} 积分`,
    checkedInToday: (checked, total) => `今日已签到 ${checked}/${total}`,
    addAccount: '添加账号',
    selectedAccounts: (count) => `已选择 ${count} 个账号`,
    checkinSelected: '签到所选',
    noAccounts: '暂无账号',
    addFirstAccount: '添加你的第一个 Trae 账号...',
    addYourFirstAccount: '添加第一个账号',
    active: '当前使用',
    credits: '积分',
    free: '免费版',
    pro: '专业版',
    enterprise: '企业版',
    checkedIn: '已签到',
    notCheckedIn: '未签到',
    lastCheckin: (date) => `上次签到：${date}`,
    checkin: '签到',
    refreshData: '刷新数据',
    switchToThis: '切换到此账号',
    switching: '切换中…',
    deleteAccount: '删除账号',
    clickToConfirm: '再次点击确认删除',
    deselectedAll: '取消全选',
    selectAllAccounts: '全选',
    usageDetails: '额度用量明细',
    usageRecords: '消费记录',
    usageRecord: '用量记录',
    usageTime: '时间',
    usageModel: '模型',
    usageProduct: '产品',
    usageCredits: '消耗积分',
    usageTokens: 'Token',
    usageEmpty: '暂无消费记录',
    usageLoadFailed: '消费记录加载失败',
    usageRetry: '重试',
    usageUpdatedAt: (date) => `数据更新于：${date}`,
    collapseDetails: '收起明细',
    usageDetailsTitle: '用量明细',
    usageToday: '今天',
    usage7Days: '7 天',
    usage30Days: '30 天',
    usageTokensIn: '输入',
    usageTokensOut: '输出',
    usageTotalRecords: (total) => `共 ${total} 条`,
    usagePrevPage: '上一页',
    usageNextPage: '下一页',
    usagePageInfo: (page, pages) => `第 ${page} / ${pages} 页`,
    checkinCreditsLabel: '签到积分',
    statTotalAccounts: '账号总数',
    statTodayUsage: '今日用量',
    statRemainingCredits: '剩余积分',
    statUsageRate: '总使用率',
    statTotalUsage: '累计用量',
  },

  batchCheckin: {
    title: '批量签到',
    subtitle: '选择账号进行每日签到以领取积分',
    selected: (selected, total) => `已选择：${selected} / ${total} 个账号`,
    notCheckedIn: (count) => `未签到：${count}`,
    selectUnchecked: '选择未签到',
    startCheckin: (count) => `开始签到 (${count})`,
    running: '运行中...',
    newlyCheckedIn: '新签到成功',
    alreadyChecked: '已签到',
    failed: '失败',
    totalProcessed: '总计处理',
    noAccounts: '暂无添加的账号。',
    addAccountsFirst: '请先添加账号以使用批量签到功能。',
    checkinSuccess: '签到成功',
    alreadyCheckedToday: '今日已签到',
    checkinFailed: '签到失败',
  },

  stats: {
    title: '数据统计',
    subtitle: '您的 Trae 账号和积分概览',
    totalAccounts: '账号总数',
    totalCredits: '积分总计',
    checkedInToday: '今日已签到',
    proAccounts: '专业版账号',
    creditsByAccount: '各账号积分',
    accountStatus: '账号状态',
    noAccounts: '暂无账号',
  },

  settings: {
    title: '设置',
    subtitle: '管理您的账号和应用设置',
    switchSettings: '切号设置',
    autoCloseTrae: '切号时自动关闭 Trae',
    autoCloseTraeDescription: '自动关闭 Trae → 切换账号 → 重新打开（类似 Cockpit）',
    autoRestartTrae: '切号后自动重启 Trae',
    autoRestartTraeDescription: '切换账号后自动启动 Trae',
    traeExePath: 'Trae 可执行文件路径',
    traeExePathDescription: '留空则自动检测。用于切号后重新启动 Trae。',
    detectPath: '自动检测',
    pathDetected: '已检测到路径',
    pathNotFound: '未找到',
    pathPlaceholder: '例如 D:\\TRAE SOLO CN\\TRAE SOLO CN.exe',
    dataManagement: '数据管理',
    exportAccounts: '导出账号',
    exportDescription: '将所有账号导出为 JSON 文件（包含令牌）',
    allAccounts: '所有账号',
    importAccounts: '导入账号',
    importDescription: '从之前导出的 JSON 文件导入账号',
    about: '关于',
    version: '版本',
    accountsStored: '已存储账号',
    dataLocation: '数据位置',
    securityNote: '安全提示：导出的 JSON 文件包含明文身份验证令牌，请妥善保管，切勿与他人分享。',
    quickTips: '快速提示',
    tip1: '切换账号前请完全关闭 Trae 以避免冲突',
    tip2: '每日使用批量签到快速领取所有账号积分',
    tip3: '定期导出账号作为备份',
    tip4: '每日签到每个账号可获得 200 Work 专属积分',
    language: '语言',
    languageDescription: '选择您偏好的显示语言',
    english: 'English',
    chinese: '简体中文',
  },

  addAccount: {
    title: '添加账号',
    oauthLogin: 'OAuth 登录',
    oauthDescription: '通过浏览器窗口登录',
    oauthInstructions: '点击下方按钮打开 Trae 登录窗口，将弹出浏览器窗口供您完成登录。',
    tokenImport: '令牌导入',
    tokenDescription: '手动粘贴令牌',
    tokenPlaceholder: '在此粘贴您的令牌...',
    tokenHint: '您可以在浏览器开发者工具或 Trae 存储中找到令牌',
    localAccount: '本地账号',
    localDescription: '从 Trae 导入',
    foundLocalAccount: (name) => `找到本地账号：${name}`,
    noLocalAccount: '未找到本地账号',
    localLoginFirst: '请先登录 Trae，然后重启此应用',
    jsonFile: 'JSON 文件',
    jsonDescription: '从 JSON 文件导入',
    jsonSelectFile: '选择之前导出的 JSON 文件...',
    jsonHint: '从导出的 JSON 备份文件导入账号',
    login: '登录',
    addToken: '添加令牌',
    importLocal: '导入',
    selectFile: '选择文件',
    processing: '处理中...',
    noLocalFoundTip: '未找到本地账号，请先登录 Trae。',
    loginViaBrowser: '通过浏览器窗口登录',
    pasteToken: '手动粘贴令牌',
    importFromTrae: '从 Trae 导入',
    importFromJson: '从 JSON 文件导入',
  },

  toast: {
    allAccountsRefreshed: '所有账号已刷新',
    accountAdded: (name) => `账号 "${name}" 添加成功`,
    loggedInAs: (name) => `已登录为 "${name}"`,
    importedLocal: (name) => `已导入本地账号 "${name}"`,
    importedAccounts: (count) => `已导入 ${count} 个账号`,
    exportedSuccess: '账号导出成功',
    accountDeleted: '账号已删除',
    switchedTo: (name) => `已切换到 "${name}"`,
    traeRestartFailed: '账号已切换，但未能重启 Trae（未找到程序路径）。请在设置中配置 Trae 路径。',
    alreadyCheckedIn: '今日已签到',
    checkedIn: (credits) => `签到成功！+${credits} 积分`,
    batchComplete: (success, already, failed, total) => `批量签到完成：${success} 个成功，${already} 个已签到，${failed} 个失败（共 ${total} 个）`,
    openingLogin: '正在打开登录窗口...',
    selectAtLeastOne: '请至少选择一个账号',
    closeTraeFirst: '切换账号前请先关闭 Trae',
    failedLoadAccounts: '加载账号失败',
    failedRefresh: '刷新账号失败',
    failedAddAccount: '添加账号失败',
    loginFailed: '登录失败',
    failedImportLocal: '导入本地账号失败',
    importFailed: '导入失败',
    exportFailed: '导出失败',
    failedDelete: '删除账号失败',
    failedSwitch: '切换账号失败',
    checkinFailed: '签到失败',
    batchFailed: '批量签到失败',
    tokenRequired: '请输入令牌',
  },

  window: {
    title: 'Trae 账号管理器',
  },
};

export const translations: Record<Language, Translations> = { en, zh };

export function getTranslations(language: Language): Translations {
  return translations[language] || translations.en;
}
